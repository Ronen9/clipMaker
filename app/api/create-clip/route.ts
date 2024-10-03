import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { Queue, Worker, Job } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

// Add a simple logging function
function log(level: 'info' | 'warn' | 'error', message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${level.toUpperCase()}: ${message}`, meta);
}

const execAsync = promisify(exec);

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const TEMP_DIR = path.join(process.cwd(), 'temp');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'output');

fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(OUTPUT_DIR);

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let redisClient: Redis;
try {
  redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', redisOptions);
  log('info', 'Redis connection established');
} catch (error) {
  log('error', 'Failed to connect to Redis', error);
  throw error;
}

const clipQueue = new Queue('clipCreation', { connection: redisClient });

// Placeholder for webhook URL
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://hook.eu1.make.com/your_webhook_endpoint';

export async function POST(req: NextRequest) {
  console.log('Received POST request to /api/create-clip');
  const sessionId = uuidv4();
  log('info', `Starting new clip creation session`, { sessionId });

  try {
    const body = await req.json();
    console.log('Request body:', body);
    const formData = await req.formData();
    const files: File[] = [];
    const metadata: Record<string, any> = {};

    for (const [key, value] of Array.from(formData.entries())) {
      if (value instanceof File) {
        files.push(value);
      } else {
        metadata[key] = value;
      }
    }

    if (files.length === 0) {
      log('warn', 'No files uploaded', { sessionId });
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    const sessionDir = path.join(TEMP_DIR, sessionId);
    fs.ensureDirSync(sessionDir);

    const mediaItems = await Promise.all(files.map(async (file, index) => {
      const fileName = `${index}_${file.name}`;
      const filePath = path.join(sessionDir, fileName);
      await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));
      log('info', `File saved`, { sessionId, fileName });
      return {
        path: filePath,
        type: file.type.startsWith('image/') ? 'image' : 'video',
        duration: parseFloat(metadata[`duration${index}`] || '4'),
        text: metadata[`text${index}`] || '',
      };
    }));

    const outputFileName = `${sessionId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    // Add job to the queue
    const job = await clipQueue.add('createClip', { mediaItems, outputPath, sessionId });
    log('info', `Clip creation job added to queue`, { sessionId, jobId: job.id });

    return NextResponse.json({ 
      message: 'Clip creation job added to queue', 
      jobId: job.id,
      sessionId
    });
  } catch (error) {
    log('error', 'Error in POST handler', { sessionId, error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createClip(mediaItems: any[], outputPath: string, jobId: string) {
  log('info', `Starting clip creation`, { jobId });
  let command = ffmpeg();

  // Ensure the necessary fonts are installed on the server
  // For Render, you might need to install fonts in the build process
  const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

  try {
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const fadeDuration = 0.5;

      if (item.type === 'image') {
        command = command.input(item.path)
          .loop(item.duration)
          .inputOptions(`-t ${item.duration}`);
      } else {
        command = command.input(item.path)
          .inputOptions(`-t ${Math.min(item.duration, 30)}`);
      }

      if (i > 0) {
        command = command.complexFilter([
          `[${i-1}:v]fade=t=out:st=${item.duration - fadeDuration}:d=${fadeDuration}[fade${i-1}]`,
          `[${i}:v]fade=t=in:st=0:d=${fadeDuration}[fade${i}]`,
          `[fade${i-1}][fade${i}]overlay=shortest=1`
        ]);
      }

      // Add text overlay with animation
      if (item.text) {
        command = command.complexFilter([
          `drawtext=fontfile=${fontPath}:fontsize=24:fontcolor=white@0.8:box=1:boxcolor=black@0.4:boxborderw=5:x=(w-tw)/2:y=h-th-20:text='${item.text}':enable='between(t,0,${item.duration-0.5})':alpha='if(lt(t,${item.duration-0.5}),1,0)'`
        ]);
      }
    }

    command.outputOptions('-movflags faststart')
      .output(outputPath);

    return new Promise((resolve, reject) => {
      command.on('start', (commandLine) => {
        log('info', `FFmpeg command: ${commandLine}`, { jobId });
      }).on('end', () => {
        log('info', `Clip creation completed`, { jobId });
        resolve(null);
      }).on('error', (err) => {
        log('error', `Error in clip creation`, { jobId, error: err });
        reject(err);
      }).run();
    });
  } catch (error) {
    log('error', `Error in createClip function`, { jobId, error });
    throw error;
  }
}

// Add this function to handle the job processing
async function processClipJob(job: Job<any, any, string>) {
  const { mediaItems, outputPath, sessionId } = job.data;
  const jobId = job.id || 'unknown';
  
  try {
    log('info', `Processing clip job`, { jobId, sessionId });
    await createClip(mediaItems, outputPath, jobId);
    
    if (WEBHOOK_URL) {
      // Send the clip to the webhook
      log('info', `Sending clip to webhook`, { jobId, sessionId });
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipUrl: outputPath, sessionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to send clip to webhook');
      }
    } else {
      log('warn', `Webhook URL not set, skipping webhook call`, { jobId, sessionId });
    }

    // Schedule file cleanup
    setTimeout(async () => {
      try {
        await fs.remove(outputPath);
        log('info', `Cleaned up file`, { jobId, sessionId, outputPath });
      } catch (error) {
        log('error', `Error cleaning up file`, { jobId, sessionId, outputPath, error });
      }
    }, 15 * 60 * 1000); // 15 minutes

    log('info', `Clip job processed successfully`, { jobId, sessionId });
    return { success: true, clipUrl: outputPath };
  } catch (error) {
    log('error', `Error processing clip job`, { jobId, sessionId, error });
    throw error;
  }
}

// Set up the worker
const worker = new Worker<any, any, string>('clipCreation', processClipJob, { connection: redisClient });

// Error handler for the worker
worker.on('error', (error) => {
  log('error', `Worker error`, { error });
});

// Completed job handler
worker.on('completed', (job) => {
  if (job) {
    log('info', `Job completed`, { jobId: job.id });
  } else {
    log('warn', `Job completed, but job object is undefined`);
  }
});

// Failed job handler
worker.on('failed', (job, error) => {
  if (job) {
    log('error', `Job failed`, { jobId: job.id, error });
  } else {
    log('error', `Job failed, but job object is undefined`, { error });
  }
});
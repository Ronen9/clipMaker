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
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${level.toUpperCase()}: ${message}`, meta);
}

const execAsync = promisify(exec);

// Use path.resolve to get the absolute path
const ffmpegPath = path.resolve(process.cwd(), ffmpegStatic as string);
ffmpeg.setFfmpegPath(ffmpegPath);

console.log('FFmpeg path:', ffmpegPath); // Add this log to check the path

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
  log('error', 'Failed to connect to Redis', error instanceof Error ? error.message : String(error));
  throw error;
}

const clipQueue = new Queue('clipCreation', { connection: redisClient });

// Placeholder for webhook URL
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://hook.eu1.make.com/your_webhook_endpoint';

import { execSync } from 'child_process';

try {
  execSync(`"${ffmpegPath}" -version`);
  console.log('FFmpeg is accessible');
} catch (error) {
  console.error('FFmpeg is not accessible:', error instanceof Error ? error.message : String(error));
}

export async function POST(req: NextRequest) {
  console.log('Received POST request to /api/create-clip');
  const sessionId = uuidv4();
  log('info', `Starting new clip creation session`, { sessionId });

  try {
    const formData = await req.formData();
    const files: File[] = [];
    const metadata: Record<string, any> = {};
    const savedFilePaths: string[] = [];

    for (const [key, value] of Array.from(formData.entries())) {
      if (value instanceof File) {
        const filePath = path.join(TEMP_DIR, `${sessionId}_${value.name}`);
        await fs.writeFile(filePath, Buffer.from(await value.arrayBuffer()));
        savedFilePaths.push(filePath);
        files.push(value);
      } else {
        metadata[key] = value;
      }
    }

    if (savedFilePaths.length === 0) {
      throw new Error('No files were uploaded');
    }

    console.log('Saved files:', savedFilePaths);
    console.log('Received metadata:', metadata);

    const jobId = await clipQueue.add('createClip', {
      mediaItems: savedFilePaths.map((filePath, index) => ({
        path: filePath,
        duration: parseFloat(metadata[`duration${index}`]),
        type: metadata[`type${index}`],
        text: metadata[`text${index}`],
      })),
      outputPath: path.join(OUTPUT_DIR, `${sessionId}.mp4`),
      sessionId,
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Clip creation job queued',
      jobId: jobId.id,
      sessionId 
    });

  } catch (error) {
    console.error('Error processing request:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Error processing request' }, { status: 500 });
  }
}

async function createClip(mediaItems: MediaItem[], outputPath: string, jobId: string) {
  try {
    log('info', `Starting clip creation`, { jobId, mediaItemCount: mediaItems.length, outputPath });
    let command = ffmpeg();

    const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
    if (!fs.existsSync(fontPath)) {
      log('warn', `Font file not found: ${fontPath}. Text overlays may not work.`, { jobId });
    } else {
      log('info', `Font file found: ${fontPath}`, { jobId });
    }

    let totalDuration = 0;
    const filters = [];
    const inputs = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const fadeDuration = 0.5;

      log('info', `Processing media item ${i + 1}`, { jobId, type: item.type, duration: item.duration, text: item.text, path: item.path });

      if (item.type === 'image') {
        command = command.input(item.path).loop();
        const duration = parseFloat(item.duration) || 4; // Default to 4 seconds if invalid
        totalDuration += duration;
        let filterString = `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
        filterString += `,trim=duration=${duration}`;
        const effectiveFadeDuration = Math.min(fadeDuration, duration / 2);
        filterString += `,fade=t=in:st=0:d=${effectiveFadeDuration},fade=t=out:st=${duration - effectiveFadeDuration}:d=${effectiveFadeDuration}`;
        filterString += `[v${i}]`;
        filters.push(filterString);
      } else if (item.type === 'video') {
        command = command.input(item.path);
        const duration = isFinite(parseFloat(item.duration)) ? parseFloat(item.duration) : 10;
        totalDuration += duration;
        console.log(`Video media item duration: ${duration} seconds`);
        let filterString = `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
        filterString += `,setpts=PTS-STARTPTS`;
        filterString += `,fade=t=in:st=0:d=${fadeDuration}`;
        filterString += `,fade=t=out:st=${duration - fadeDuration}:d=${fadeDuration}`;
        filterString += `[v${i}]`;
        filters.push(filterString);
      }
      
      inputs.push(`[v${i}]`);

      if (item.text) {
        filters.push(`[v${i}]drawtext=fontfile='${fontPath}':fontsize=24:fontcolor=white:x=(w-tw)/2:y=h-th-10:text='${item.text}'[v${i}text]`);
        inputs[inputs.length - 1] = `[v${i}text]`;
      }
    }

    filters.push(`${inputs.join('')}concat=n=${mediaItems.length}:v=1:a=0[outv]`);

    command.complexFilter(filters)
      .outputOptions('-map', '[outv]')
      .outputOptions('-t', totalDuration.toString())
      .outputOptions('-movflags', '+faststart')
      .outputOptions('-c:v', 'libx264')
      .outputOptions('-preset', 'ultrafast')
      .outputOptions('-crf', '23')
      .outputOptions('-metadata', 'title=')
      .outputOptions('-metadata', 'comment=')
      .outputOptions('-metadata', 'description=')
      .outputOptions('-metadata', 'copyright=')
      .outputOptions('-metadata', 'author=')
      .outputOptions('-metadata', 'album=')
      .outputOptions('-metadata', 'artist=')
      .output(outputPath);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        command.kill('SIGTERM');
        reject(new Error('FFmpeg process timed out after 15 minutes'));
      }, 15 * 60 * 1000);

      let lastProgress = Date.now();
      command.on('start', (commandLine) => {
        log('info', `FFmpeg command: ${commandLine}`, { jobId });
        console.log('\nFFmpeg Progress:');
      }).on('stderr', (stderrLine) => {
        log('debug', `FFmpeg stderr: ${stderrLine}`, { jobId });
      }).on('progress', (progress) => {
        try {
          const now = Date.now();
          if (now - lastProgress > 1000) {
            let progressMessage = 'Processing...';
            if (progress.percent !== undefined && !isNaN(progress.percent)) {
              const percent = Math.max(0, Math.min(100, progress.percent));
              progressMessage = `Progress: ${percent.toFixed(2)}%`;
            } else if (progress.frames !== undefined && !isNaN(progress.frames)) {
              const estimatedTotalFrames = totalDuration * 30;
              const percent = Math.min(100, (progress.frames / estimatedTotalFrames) * 100);
              progressMessage = `Progress: ${percent.toFixed(2)}% (Frame ${progress.frames})`;
            }
            log('info', progressMessage, { jobId });
            lastProgress = now;
          }
        } catch (error) {
          log('error', `Error in progress reporting`, { jobId, error: error instanceof Error ? error.message : String(error) });
        }
      }).on('error', (err) => {
        clearTimeout(timeout);
        log('error', `Error in clip creation`, { jobId, error: err.message });
        reject(err);
      }).on('end', () => {
        clearTimeout(timeout);
        log('info', `Clip creation completed`, { jobId, totalDuration, outputPath });
        resolve(totalDuration);
      }).run();
    });
  } catch (error) {
    log('error', `Error in createClip function`, { jobId, error });
    throw error;
  }
}

// Add this function to handle the job processing
async function processClipJob(job: Job<{ mediaItems: MediaItem[], outputPath: string, sessionId: string }, any, string>) {
  const { mediaItems, outputPath, sessionId } = job.data;
  const jobId = job.id || 'unknown';
  
  try {
    log('info', `Processing clip job`, { jobId, sessionId });
    const totalDuration = mediaItems.reduce((total: number, item) => total + parseFloat(item.duration), 0);
    await createClip(mediaItems, outputPath, jobId);
    
    if (await fs.pathExists(outputPath)) {
      const fileStats = await fs.stat(outputPath);
      const fileSize = fileStats.size;
      const dateCreated = new Date().toISOString();

      if (WEBHOOK_URL) {
        try {
          log('info', `Sending clip to webhook`, { jobId, sessionId });
          const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clipUrl: outputPath,
              sessionId,
              fileSize,
              duration: totalDuration,
              dateCreated,
              mediaItemCount: mediaItems.length
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to send clip to webhook: ${response.status} ${response.statusText}`);
          }
          log('info', `Clip sent to webhook successfully`, { jobId, sessionId });
        } catch (error) {
          log('error', `Error sending clip to webhook`, { 
            jobId, 
            sessionId, 
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        log('warn', `Webhook URL not set, skipping webhook call`, { jobId, sessionId });
      }

      // Schedule output file cleanup
      setTimeout(async () => {
        try {
          await fs.remove(outputPath);
          log('info', `Cleaned up output file`, { jobId, sessionId, outputPath });
        } catch (error) {
          log('error', `Error cleaning up output file`, { jobId, sessionId, outputPath, error });
        }
      }, 5 * 60 * 1000); // 5 minutes

      log('info', `Clip job processed successfully`, { jobId, sessionId });
      console.log('\n\x1b[32m%s\x1b[0m', `Clip creation completed! Output file: ${outputPath}`);
      return { success: true, clipUrl: outputPath };
    } else {
      throw new Error('Output file was not created');
    }
  } catch (error) {
    log('error', `Error processing clip job`, { 
      jobId, 
      sessionId, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    // Instead of re-throwing, we'll return an error object
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Clean up temporary files
    await cleanupTempFiles(mediaItems);
  }
}

// Set up the worker
const worker = new Worker<any, any, string>('clipCreation', processClipJob, { connection: redisClient });

// Error handler for the worker
worker.on('error', (error) => {
  log('error', `Worker error`, { error: error instanceof Error ? error.message : String(error) });
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
    log('error', `Job failed`, { 
      jobId: job.id, 
      error: error instanceof Error ? error.message : String(error)
    });
  } else {
    log('error', `Job failed, but job object is undefined`, { 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

async function cleanupTempFiles(mediaItems: any[]) {
  for (const item of mediaItems) {
    try {
      await fs.remove(item.path);
    } catch (error) {
      log('error', `Error cleaning up temp file`, { path: item.path, error });
    }
  }
}

// Add this after the imports
interface MediaItem {
  path: string;
  duration: string;
  type: 'image' | 'video';
  text: string;
}
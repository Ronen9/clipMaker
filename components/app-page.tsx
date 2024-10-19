'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { toast, Toaster } from 'react-hot-toast'
import { Upload, X, Film, Image as ImageIcon, Send, Play } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface MediaItem {
  file: File
  duration: number
  preview: string
  aspectRatio: number
  type: 'image' | 'video'
  path?: string  // Optional, as it might not be used in the frontend
  text: string
}

type CaptureMode = 'image' | 'video' | null

type OrientationLockType = 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';

interface ExtendedScreenOrientation extends Omit<ScreenOrientation, 'lock' | 'unlock'> {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
}

// Add this near the top of the file, after the imports
const LoadingOverlay = ({ progress }: { progress: number }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-8 flex flex-col items-center w-80">
      <svg className="animate-spin h-12 w-12 text-indigo-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p className="text-indigo-700 font-semibold mb-2">מעבד את הקליפ...</p>
      <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 mb-2">
        <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
      </div>
    </div>
  </div>
);

export function Page() {
  // State declarations
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [textAreaValues, setTextAreaValues] = useState<string[]>(Array(5).fill(''))
  const [textAreaFocused, setTextAreaFocused] = useState<boolean[]>(Array(5).fill(false))
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  // Ref declarations
  const videoRef = useRef<HTMLVideoElement>(null)

  // Function declarations
  const createThumbnailFromVideo = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        const duration = video.duration
        const seekTime = isFinite(duration) && duration > 0 ? duration / 2 : 1
        video.currentTime = seekTime
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg'))
      }
      video.src = URL.createObjectURL(file)
    })
  }, [])

  const createVideoThumbnail = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadeddata = () => {
        video.currentTime = 0 // Set to 0 to capture the first frame
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg'))
      }
      video.src = URL.createObjectURL(file)
    })
  }, [])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    stopAllVideos(); // Stop all playing videos

    const file = event.target.files?.[0];
    if (!file) return;

    await processFile(file, mediaItems.length);
  };

  const processFile = async (file: File, index: number) => {
    try {
      let type: 'image' | 'video' = 'image';
      let preview = ''
      let aspectRatio = 1
      let duration = 0

      if (file.type.startsWith('video/')) {
        type = 'video'
        preview = await createVideoThumbnail(file)
        const video = document.createElement('video')
        video.preload = 'metadata'
        const blobUrl = URL.createObjectURL(file)
        video.src = blobUrl

        duration = await new Promise<number>((resolve) => {
          video.onloadedmetadata = () => {
            aspectRatio = video.videoWidth / video.videoHeight
            if (isFinite(video.duration) && video.duration > 0) {
              resolve(video.duration)
            } else {
              resolve(10)
            }
          }
          video.onerror = () => {
            console.error('Error loading video metadata')
            resolve(10)
          }
        })
        URL.revokeObjectURL(blobUrl)  // Revoke the blob URL after we're done with it
      } else if (file.type.startsWith('image/')) {
        type = 'image'
        const img = new Image()
        const blobUrl = URL.createObjectURL(file)
        img.src = blobUrl
        await new Promise<void>((resolve) => {
          img.onload = () => {
            aspectRatio = img.width / img.height
            preview = blobUrl  // Use the blob URL as the preview
            resolve()
          }
        })
        // Don't revoke the blob URL here, as we're using it for the preview
        duration = 4
      } else {
        throw new Error('Unsupported file type')
      }

      setMediaItems(prevItems => {
        const newMediaItems = [...prevItems]
        newMediaItems[index] = {
          file,
          duration,
          preview,
          aspectRatio,
          type,
          text: textAreaValues[index] || ''
        }
        return newMediaItems
      })
    } catch (error) {
      console.error('Error processing file:', error instanceof Error ? error.message : String(error))
      toast.error('Error processing file. Please try again.')
    }
  }

  const handleDurationChange = useCallback((value: number[], index: number) => {
    setMediaItems(prevItems => prevItems.map((item, i) => 
      i === index && item.type === 'image' 
        ? { ...item, duration: value[0] } 
        : item
    ));
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    const newMediaItems = mediaItems.filter((_, i) => i !== index)
    setMediaItems(newMediaItems)
  }, [mediaItems])

  const handleSubmit = async () => {
    stopAllVideos();

    if (mediaItems.length === 0) {
      toast.error('אנא הוסף לפחות פריט מדיה אחד לפני השליחה.');
      return;
    }

    setIsDialogOpen(true);
  };

  const handleConfirmDownload = async () => {
    setIsDialogOpen(false);
    setIsLoading(true);
    setUploadProgress(0);

    const formData = new FormData();
    let mediaCount = 0;
    
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      if (item && item.file) {
        formData.append(`file${mediaCount}`, item.file);  // This ensures we're sending the original file
        formData.append(`type${mediaCount}`, item.type);
        formData.append(`text${mediaCount}`, textAreaValues[i] || '');
        formData.append(`duration${mediaCount}`, item.duration.toString());
        mediaCount++;
      }
    }

    try {
      // Simulated progress updates
      const progressInterval = setInterval(() => {
        setUploadProgress((prevProgress) => {
          if (prevProgress >= 99) {
            clearInterval(progressInterval);
            return 99;
          }
          return prevProgress + 1;
        });
      }, 500);

      const response = await fetch('/api/create-clip', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`כשל ביצירת הקליפ: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      console.log('Clip created:', data);

      if (data.success) {
        toast.success('הקליפ נוצר בהצלחה!');
        toast((t) => (
          <span>
            הקליפ בהכנה. מזהה עבודה: {data.jobId}
          </span>
        ), { duration: 5000 });

        // Start polling for the clip URL
        pollForClipUrl(data.jobId);

        // Reset all state
        setMediaItems([]);
        setTextAreaValues(Array(5).fill(''));
        setTextAreaFocused(Array(5).fill(false));
      } else {
        throw new Error(data.error || 'אירעה שגיאה לא ידועה');
      }
    } catch (error) {
      console.error('שגיאה ביצירת הקליפ:', error instanceof Error ? error.message : String(error));
      toast.error('שגיאה ביצירת הקליפ. אנא נסה שוב.');
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
    }
  }

  const pollForClipUrl = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/create-clip?jobId=${jobId}`);
        if (!response.ok) {
          if (response.status === 404) {
            // Job not found, stop polling
            clearInterval(pollInterval);
            toast.error('הקליפ לא נמצא. אנא נסה שוב.');
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          // Still processing
          const data = await response.json();
          console.log('Clip status:', data);
          if (data.status === 'failed') {
            clearInterval(pollInterval);
            toast.error('שגיאה ביצירת הקליפ. אנא נסה שוב.');
          }
        } else {
          // Clip is ready, start download
          clearInterval(pollInterval);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = response.headers.get('content-disposition')?.split('filename=')[1].replace(/"/g, '') || 'clip.mp4';
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          toast.success('הקליפ הורד בהצלחה!');
        }
      } catch (error) {
        console.error('שגיאה בבדיקת סטטוס הקליפ:', error instanceof Error ? error.message : String(error));
        clearInterval(pollInterval);
        toast.error('שגיאה בבדיקת סטטוס הקליפ. אנא נסה שוב.');
      }
    }, 5000); // Poll every 5 seconds
  };

  useEffect(() => {
    if (clipUrl) {
      // Prepend the base URL if it's not already an absolute URL
      const fullUrl = clipUrl.startsWith('http') ? clipUrl : `${window.location.origin}${clipUrl}`;
      
      // Trigger download when clipUrl is available
      const link = document.createElement('a');
      link.href = fullUrl;
      link.download = `clip_${Date.now()}.mp4`; // Use a timestamp for a unique filename
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clear the clipUrl after download
      setClipUrl(null);
    }
  }, [clipUrl]);

  const handleTextAreaChange = (index: number, value: string) => {
    const newValues = [...textAreaValues]
    newValues[index] = value
    setTextAreaValues(newValues)
  }

  const handleTextAreaFocus = (index: number) => {
    const newFocused = [...textAreaFocused]
    newFocused[index] = true
    setTextAreaFocused(newFocused)
  }

  const handleTextAreaBlur = (index: number) => {
    const newFocused = [...textAreaFocused]
    newFocused[index] = false
    setTextAreaFocused(newFocused)
    if (!textAreaValues[index].trim()) {
      const newValues = [...textAreaValues]
      newValues[index] = ''
      setTextAreaValues(newValues)
    }
  }

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        const durationInSeconds = Math.round(video.duration);
        console.log(`Video duration: ${durationInSeconds} seconds`);
        resolve(durationInSeconds);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const calculateTotalSize = (mediaItems: MediaItem[]): number => {
    return mediaItems.reduce((total, item) => total + (item.file?.size || 0), 0);
  };

  const playVideoInThumbnail = useCallback((index: number) => {
    setPlayingVideoIndex(prevIndex => prevIndex === index ? null : index);
  }, []);

  const stopAllVideos = useCallback(() => {
    setPlayingVideoIndex(null);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-100 p-4 md:p-6 lg:p-8">
      <Toaster position="top-center" />
      {isLoading && <LoadingOverlay progress={uploadProgress} />}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md mx-auto bg-white rounded-xl shadow-lg overflow-hidden md:max-w-2xl lg:max-w-4xl"
      >
        <div className="p-4 md:p-6 lg:p-8">
          <h1 className="text-3xl font-bold text-center mb-8 text-indigo-600">Media Clip Maker</h1>
          <div className="space-y-8">
            {[...Array(5)].map((_, index) => (
              <AnimatePresence key={index}>
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`media-${index}`} className="text-lg font-bold text-indigo-700 w-full text-right mb-2 block bg-indigo-50 p-3 rounded-lg">
                      תמונה\וידאו {index + 1}
                    </Label>
                    {mediaItems[index] && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(index)}
                        className="h-10 w-10 text-red-500 hover:text-red-700 hover:bg-red-100 transition-colors"
                      >
                        <X className="h-5 w-5" />
                        <span className="sr-only">Remove media</span>
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-col md:flex-row items-start space-y-4 md:space-y-0 md:space-x-4">
                    <div className={cn(
                      "relative flex-grow w-full md:w-1/2",
                      mediaItems[index] && "md:w-2/3 lg:w-1/2"
                    )}>
                      <Input
                        id={`media-${index}`}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => handleFileChange(e)}
                      />
                      {mediaItems[index] ? (
                        <div id={`thumbnail-${index}`} className="relative w-full h-60 md:h-80 flex items-center justify-center border-2 border-indigo-300 rounded-lg overflow-hidden">
                          {playingVideoIndex === index && mediaItems[index].type === 'video' ? (
                            <video
                              src={URL.createObjectURL(mediaItems[index].file)}
                              className="max-w-full max-h-full object-contain"
                              controls
                              autoPlay
                              onEnded={() => setPlayingVideoIndex(null)}
                            />
                          ) : (
                            <>
                              <img
                                src={mediaItems[index].preview}
                                alt={`Preview of media ${index + 1}`}
                                className="max-w-full max-h-full object-contain"
                              />
                              <div className="absolute top-2 right-2 bg-white rounded-full p-2">
                                {mediaItems[index].type === 'image' ? (
                                  <ImageIcon className="w-5 h-5 text-indigo-500" />
                                ) : (
                                  <Film className="w-5 h-5 text-indigo-500" />
                                )}
                              </div>
                              {mediaItems[index].type === 'video' && (
                                <div 
                                  className="absolute inset-0 flex items-center justify-center cursor-pointer"
                                  onClick={() => playVideoInThumbnail(index)}
                                >
                                  <div className="bg-black bg-opacity-50 rounded-full p-3">
                                    <Play className="w-10 h-10 text-white" />
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col space-y-3">
                          <Label
                            htmlFor={`media-${index}`}
                            className="flex items-center justify-center w-full h-60 md:h-80 px-4 transition bg-white border-2 border-indigo-300 border-dashed rounded-lg appearance-none cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                          >
                            <span className="flex items-center space-x-2">
                              <Upload className="w-8 h-8 text-indigo-500" />
                              <span className="font-medium text-indigo-500 text-lg">Upload</span>
                            </span>
                          </Label>
                        </div>
                      )}
                    </div>
                    {mediaItems[index] && (
                      <div className="w-full md:w-1/2 lg:w-1/3 flex flex-col items-start">
                        {mediaItems[index].type === 'image' && (
                          <>
                            <Label htmlFor={`duration-${index}`} className="text-sm font-medium text-gray-700 mb-2 w-full text-right">
                              משך זמן התצוגה בקליפ הסופי
                            </Label>
                            <div className="w-full" style={{ direction: 'rtl' }}>
                              <Slider
                                id={`duration-${index}`}
                                value={[11 - mediaItems[index].duration]}
                                onValueChange={(value) => handleDurationChange([11 - value[0]], index)}
                                max={10}
                                min={1}
                                step={0.1}
                                className="w-full [&>span]:bg-indigo-500"
                                aria-label={`Set duration for media ${index + 1}`}
                              />
                            </div>
                            <p className="text-sm text-right mt-2 text-gray-600 w-full">
                              {mediaItems[index].duration.toFixed(1)}s
                            </p>
                          </>
                        )}
                        <Textarea
                          placeholder={textAreaFocused[index] ? '' : 'מה מצולם?'}
                          value={textAreaValues[index]}
                          onChange={(e) => handleTextAreaChange(index, e.target.value)}
                          onFocus={() => handleTextAreaFocus(index)}
                          onBlur={() => handleTextAreaBlur(index)}
                          className="mt-4 w-full text-right placeholder-right h-24"
                          style={{ direction: 'rtl' }}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            ))}
          </div>
          <Button
            className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors text-right font-bold text-lg py-4 rounded-lg shadow-md flex items-center justify-center"
            onClick={handleSubmit}
            disabled={mediaItems.length === 0 || isLoading}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                מעבד...
              </>
            ) : (
              <>
                <Send className="w-6 h-6 ml-2" />
                שגר\י ליצירת הקליפ
              </>
            )}
          </Button>
        </div>
      </motion.div>
      <video ref={videoRef} className="hidden" />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white rounded-xl shadow-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-indigo-600 text-center">יצירת הקליפ</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-500 text-right">
              האם אתה בטוח שברצונך ליצור את הקליפ? לאחר האישור, הקליפ ייווצר ויורד למכשירך.
            </p>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="w-full sm:w-auto border-indigo-600 text-indigo-600 hover:bg-indigo-50"
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDownload}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              אישור והורדה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

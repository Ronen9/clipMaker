'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { toast, Toaster } from 'react-hot-toast'
import { Upload, Camera, X, Film, Image as ImageIcon, Check, RotateCcw, Play, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type MediaItem = {
  file: File
  duration: number
  preview: string
  aspectRatio: number
  type: 'image' | 'video'
}

type CaptureMode = 'image' | 'video' | null

export function Page() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [capturedMedia, setCapturedMedia] = useState<Blob | null>(null)
  const [capturedMediaURL, setCapturedMediaURL] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [textAreaValues, setTextAreaValues] = useState<string[]>(Array(5).fill(''))
  const [textAreaFocused, setTextAreaFocused] = useState<boolean[]>(Array(5).fill(false))

  const videoRef = useRef<HTMLVideoElement>(null)
  const captureVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const createVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadeddata = () => {
        video.currentTime = 1 // Set to 1 second or another appropriate time
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
  }

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = event.target.files?.[0]
    if (file) {
      await processFile(file, index)
    }
  }, [])

  const processFile = async (file: File, index: number) => {
    try {
      let preview: string
      let aspectRatio: number
      let type: 'image' | 'video'

      if (file.type.startsWith('image/')) {
        type = 'image'
        const img = await createImageBitmap(file)
        aspectRatio = img.width / img.height
        preview = URL.createObjectURL(file)
      } else if (file.type.startsWith('video/')) {
        type = 'video'
        preview = await createVideoThumbnail(file)
        const video = document.createElement('video')
        video.src = URL.createObjectURL(file)
        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            aspectRatio = video.videoWidth / video.videoHeight
            resolve(null)
          }
        })
      } else {
        throw new Error('Unsupported file type')
      }

      setMediaItems(prevItems => {
        const newMediaItems = [...prevItems]
        newMediaItems[index] = {
          file,
          duration: 4,
          preview,
          aspectRatio,
          type
        }
        return newMediaItems
      })
    } catch (error) {
      console.error('Error processing file:', error)
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
    try {
      const formData = new FormData();
      mediaItems.forEach((item, index) => {
        formData.append(`file${index}`, item.file);
        formData.append(`duration${index}`, item.duration.toString());
        formData.append(`type${index}`, item.type);
        formData.append(`text${index}`, textAreaValues[index]);
      });

      const response = await fetch('/api/create-clip', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to create clip');
      }

      const data = await response.json();
      toast.success('הקליפ נוצר בהצלחה!');
      
      // Provide a link to the created video
      const videoLink = `<a href="${data.videoUrl}" target="_blank">צפה בקליפ</a>`;
      toast((t) => (
        <span>
          הקליפ מוכן! {' '}
          <span dangerouslySetInnerHTML={{ __html: videoLink }} />
        </span>
      ), { duration: 5000 });

      // Reset state
      setMediaItems([]);
      setTextAreaValues(Array(5).fill(''));
      setTextAreaFocused(Array(5).fill(false));
    } catch (error) {
      console.error('Error creating clip:', error);
      toast.error('שגיאה ביצירת הקליפ. אנא נסה שוב.');
    }
  };

  const checkMediaDevicesSupport = () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast.error('Your browser does not support media devices. Please try a different browser.')
      return false
    }
    return true
  }

  const startCapture = useCallback(async (index: number, mode: CaptureMode) => {
    if (!checkMediaDevicesSupport()) return

    console.log('Starting capture:', mode)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: mode === 'video' 
      })
      console.log('Stream obtained:', stream)
      streamRef.current = stream
      setIsCapturing(true)
      setCaptureMode(mode)
      setCurrentIndex(index)
      setIsCameraReady(false) // Reset camera ready state
    } catch (error) {
      console.error('Error accessing camera:', error)
      let errorMessage = 'Unable to access camera. Please check your permissions.'
      if (error instanceof DOMException) {
        switch (error.name) {
          case 'NotFoundError':
            errorMessage = 'No camera detected. Please ensure your camera is properly connected and not in use by another application.'
            break
          case 'NotAllowedError':
            errorMessage = 'Camera access was denied. Please grant camera permissions and try again.'
            break
          case 'NotReadableError':
            errorMessage = 'Camera is in use by another application or encountered a hardware error. Please close other apps using the camera and try again.'
            break
          default:
            errorMessage = `Camera error: ${error.message}`
        }
      }
      toast.error(errorMessage)
    }
  }, [])

  const stopCapture = useCallback(() => {
    console.log('Stopping capture')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (captureVideoRef.current) {
      captureVideoRef.current.srcObject = null
    }
    setIsCapturing(false)
    setCaptureMode(null)
    setCurrentIndex(null)
    setCapturedMedia(null)
    setCapturedMediaURL(null)
    setIsRecording(false)
    setIsCameraReady(false)
  }, [])

  const captureImage = useCallback(() => {
    console.log('Capturing image')
    if (captureVideoRef.current) {
      const canvas = document.createElement('canvas')
      canvas.width = captureVideoRef.current.videoWidth
      canvas.height = captureVideoRef.current.videoHeight
      canvas.getContext('2d')?.drawImage(captureVideoRef.current, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) {
          setCapturedMedia(blob)
          setCapturedMediaURL(URL.createObjectURL(blob))
        }
      }, 'image/jpeg')
      console.log('Image captured')
    } else {
      console.error('Capture video ref is null')
      toast.error('Error capturing image. Please try again.')
    }
  }, [])

  const startRecording = useCallback(() => {
    console.log('Starting recording')
    if (streamRef.current) {
      mediaRecorderRef.current = new MediaRecorder(streamRef.current)
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        setCapturedMedia(blob)
        setCapturedMediaURL(URL.createObjectURL(blob))
        chunksRef.current = []
      }
      mediaRecorderRef.current.start()
      setIsRecording(true)
    } else {
      console.error('Stream ref is null')
      toast.error('Error starting recording. Please try again.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    console.log('Stopping recording')
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    } else {
      console.error('MediaRecorder is not available or not recording')
      toast.error('Error stopping recording. Please try again.')
    }
  }, [isRecording])

  const confirmCapture = useCallback(async () => {
    if (capturedMedia && currentIndex !== null) {
      try {
        let preview: string
        let aspectRatio: number

        if (captureMode === 'video') {
          const videoFile = new File([capturedMedia], 'video.mp4', { type: 'video/mp4' })
          preview = await createThumbnailFromVideo(videoFile)
          const video = document.createElement('video')
          video.src = URL.createObjectURL(videoFile)
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => {
              aspectRatio = video.videoWidth / video.videoHeight
              resolve()
            }
          })
        } else {
          preview = capturedMediaURL || ''
          aspectRatio = captureVideoRef.current ? captureVideoRef.current.videoWidth / captureVideoRef.current.videoHeight : 16 / 9
        }

        const file = new File([capturedMedia], `captured_${captureMode}.${captureMode === 'image' ? 'jpg' : 'mp4'}`, {
          type: captureMode === 'image' ? 'image/jpeg' : 'video/mp4'
        })

        setMediaItems(prevItems => {
          const newMediaItems = [...prevItems]
          newMediaItems[currentIndex] = {
            file,
            duration: 4,
            preview,
            aspectRatio,
            type: captureMode === 'image' ? 'image' : 'video'
          }
          return newMediaItems
        })

        stopCapture()
      } catch (error) {
        console.error('Error confirming capture:', error)
        toast.error('Error confirming capture. Please try again.')
      }
    }
  }, [capturedMedia, currentIndex, captureMode, capturedMediaURL, stopCapture])

  const resetCaptureState = useCallback(() => {
    setCapturedMedia(null)
    setCapturedMediaURL(null)
    setIsCameraReady(false)
  }, [])

  const playVideoInThumbnail = (index: number) => {
    const videoElement = document.createElement('video')
    videoElement.src = URL.createObjectURL(mediaItems[index].file)
    videoElement.className = 'max-w-full max-h-full object-contain'
    videoElement.controls = true
    videoElement.autoplay = true

    const thumbnailContainer = document.getElementById(`thumbnail-${index}`)
    if (thumbnailContainer) {
      thumbnailContainer.innerHTML = ''
      thumbnailContainer.appendChild(videoElement)
    }
  }

  useEffect(() => {
    return () => {
      stopCapture()
    }
  }, [stopCapture])

  useEffect(() => {
    if (isCapturing && captureVideoRef.current && streamRef.current) {
      captureVideoRef.current.srcObject = streamRef.current
      captureVideoRef.current.onloadedmetadata = () => {
        captureVideoRef.current?.play()
          .then(() => {
            console.log('Video playback started')
            setIsCameraReady(true)
          })
          .catch((playError) => {
            console.error('Error playing video:', playError)
            toast.error('Error starting camera. Please try again.')
          })
      }
    }
  }, [isCapturing, capturedMediaURL])

  const createThumbnailFromVideo = (file: File): Promise<string> => {
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
  }

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-100 p-4 md:p-6 lg:p-8">
      <Toaster position="top-center" />
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
                        onChange={(e) => handleFileChange(e, index)}
                      />
                      {mediaItems[index] ? (
                        <div id={`thumbnail-${index}`} className="relative w-full h-60 md:h-80 flex items-center justify-center border-2 border-indigo-300 rounded-lg overflow-hidden">
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
                          <div className="flex space-x-2">
                            <Button
                              onClick={() => startCapture(index, 'image')}
                              className="flex-1 bg-indigo-100 text-indigo-600 hover:bg-indigo-200 py-3"
                            >
                              <Camera className="w-5 h-5 mr-2" />
                              Capture Image
                            </Button>
                            <Button
                              onClick={() => startCapture(index, 'video')}
                              className="flex-1 bg-indigo-100 text-indigo-600 hover:bg-indigo-200 py-3"
                            >
                              <Film className="w-5 h-5 mr-2" />
                              Record Video
                            </Button>
                          </div>
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
            disabled={mediaItems.length === 0}
          >
            <Send className="w-6 h-6 ml-2" />
            שגר\י ליצירת הקליפ
          </Button>
        </div>
      </motion.div>
      <video ref={videoRef} className="hidden" />

      {isCapturing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg shadow-lg max-w-2xl w-full">
            <h2 className="text-2xl font-bold mb-4">
              {captureMode === 'image' ? 'Capture Image' : 'Record Video'}
            </h2>
            <div className="relative aspect-video mb-4">
              {!capturedMediaURL && (
                <video
                  ref={captureVideoRef}
                  className="w-full h-full object-cover rounded-lg"
                  autoPlay
                  playsInline
                  muted
                />
              )}
              {capturedMediaURL && (
                <div className="absolute inset-0 flex items-center justify-center">
                  {captureMode === 'image' ? (
                    <img
                      src={capturedMediaURL}
                      alt="Captured"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <video
                      src={capturedMediaURL}
                      className="max-w-full max-h-full object-contain"
                      controls
                    />
                  )}
                </div>
              )}
              {!isCameraReady && !capturedMediaURL && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
                  Loading camera...
                </div>
              )}
            </div>
            <div className="flex justify-between">
              {!capturedMediaURL ? (
                <>
                  <Button onClick={stopCapture} className="bg-red-500 hover:bg-red-600 text-white">
                    Cancel
                  </Button>
                  {captureMode === 'image' ? (
                    <Button onClick={captureImage} className="bg-green-500 hover:bg-green-600 text-white" disabled={!isCameraReady}>
                      Capture
                    </Button>
                  ) : (
                    <Button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} text-white`}
                      disabled={!isCameraReady}
                    >
                      {isRecording ? 'Stop Recording' : 'Start Recording'}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button onClick={() => { resetCaptureState() }} className="bg-yellow-500 hover:bg-yellow-600 text-white">
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Retake
                  </Button>
                  <Button onClick={confirmCapture} className="bg-green-500 hover:bg-green-600 text-white">
                    <Check className="w-4 h-4 mr-2" />
                    Confirm
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
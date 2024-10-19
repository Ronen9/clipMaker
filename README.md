ClipMaker
ClipMaker is a Next.js application that allows users to create video clips by combining images and videos with custom text overlays.
Features
Upload and process multiple image and video files
Add custom text overlays to each media item
Create a single video clip from the uploaded media
Optimized for Facebook post format (4:5 aspect ratio)
Real-time progress updates during clip creation
Automatic download of the final clip
Technologies Used
Next.js 14
React 18
TypeScript
Tailwind CSS
FFmpeg for video processing
Redis for job queue management
BullMQ for background job processing
Getting Started
Prerequisites
Node.js (version 14 or later)
Redis server
Installation
Clone the repository:
Install dependencies:
Set up environment variables:
Create a .env.local file in the root directory and add the following:
Run the development server:
Open http://localhost:3000 in your browser to see the application.
Project Structure
app/: Next.js app directory
components/: React components
public/: Static assets
scripts/: Utility scripts
app/api/: API routes for clip creation and processing
Key Components
app-page.tsx: Main application page component
create-clip/route.ts: API route for clip creation and processing
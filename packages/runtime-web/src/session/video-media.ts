import { hasCurrentVideoFrame, waitForVideoLoadedData } from '../video-readiness';

/**
 * Attempt to play a video element, retrying after `loadeddata` if the first
 * `play()` call is aborted (common on mobile when the element is not yet attached).
 */
export async function ensureVideoPlayback(video: HTMLVideoElement): Promise<void> {
  const attemptPlay = async (): Promise<boolean> => {
    try {
      await video.play();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return false;
      }
      throw error;
    }
  };

  if (await attemptPlay()) {
    return;
  }

  await waitForVideoLoadedData(video, 1500, 'Video failed to load camera stream');

  await video.play();
}

/**
 * Wait until the video has at least one frame available for rendering.
 */
export async function ensureVideoFrameReady(video: HTMLVideoElement): Promise<void> {
  if (hasCurrentVideoFrame(video)) {
    return;
  }
  await waitForVideoLoadedData(video, 1000, 'Video frame unavailable for capture');
}

/**
 * Stop all tracks on a MediaStream and detach it from the video element.
 */
export function cleanupVideoStream(
  video: HTMLVideoElement | undefined,
  stream: MediaStream | undefined,
): void {
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

export async function waitForVideoLoadedData(
  video: HTMLVideoElement,
  timeoutMs: number,
  errorMessage: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutHandle = 0;
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
      if (timeoutHandle) {
        window.clearTimeout(timeoutHandle);
      }
    };
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };
    const onLoadedData = () => finish(resolve);
    const onError = () => finish(() => reject(new Error(errorMessage)));

    video.addEventListener('loadeddata', onLoadedData, { once: true });
    video.addEventListener('error', onError, { once: true });
    timeoutHandle = window.setTimeout(() => finish(resolve), timeoutMs);
  });
}

export function hasCurrentVideoFrame(video: HTMLVideoElement): boolean {
  return (
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  );
}

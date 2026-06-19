export async function waitForPreload(retries = 10): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (retries <= 0) {
      reject(new Error("Preload script not loaded"));
      return;
    }
    if ((window as any).Preloaded) {
      resolve(true);
    } else {
      setTimeout(() => {
        waitForPreload(retries - 1)
          .then(resolve)
          .catch(reject);
      }, 150);
    }
  });
}

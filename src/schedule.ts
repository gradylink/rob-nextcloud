export const scheduleDaily = (
  hour: number,
  minute: number,
  task: () => void | Promise<void>,
): void => {
  const msUntilNext = (): number => {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0,
    );
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  const run = async () => {
    try {
      await task();
    } catch (e) {
      console.warn(e);
    } finally {
      setTimeout(run, msUntilNext());
    }
  };

  setTimeout(run, msUntilNext());
};

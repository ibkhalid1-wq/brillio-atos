import { useEffect, useState } from "react";

export function useRelativeTimeTick() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 60_000);

    return () => window.clearInterval(id);
  }, []);
}

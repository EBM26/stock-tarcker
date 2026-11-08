// Per-device conveniences (selected list, chart range...). Safe if storage is unavailable.
export const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`st:${key}`));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`st:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable; ignore */
    }
  },
};

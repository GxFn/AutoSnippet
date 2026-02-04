/**
 * FileDebouncer - 文件事件防抖器
 */

class FileDebouncer {
  constructor(delay = 300) {
    this.delay = delay;
    this.timers = new Map();
  }

  debounce(key, callback) {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, this.delay);

    this.timers.set(key, timer);
  }
  
  clear(key) {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

module.exports = FileDebouncer;

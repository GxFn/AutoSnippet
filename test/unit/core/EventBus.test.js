/**
 * EventBus 单元测试
 */

const assert = require('assert');
const EventBus = require('../../../lib/core/EventBus');

describe('EventBus', () => {
  let eventBus;

  beforeEach(() => {
  eventBus = new EventBus();
  });

  describe('emit and listen', () => {
  it('should emit event and call listener', (done) => {
    eventBus.on('test', (data) => {
    assert.equal(data.value, 42);
    done();
    });

    eventBus.emit('test', { value: 42 });
  });

  it('should emit with multiple arguments', (done) => {
    eventBus.on('test', (arg1, arg2, arg3) => {
    assert.equal(arg1, 1);
    assert.equal(arg2, 2);
    assert.equal(arg3, 3);
    done();
    });

    eventBus.emit('test', 1, 2, 3);
  });

  it('should call multiple listeners', () => {
    let count = 0;

    eventBus.on('test', () => count++);
    eventBus.on('test', () => count++);
    eventBus.on('test', () => count++);

    eventBus.emit('test');

    assert.equal(count, 3);
  });
  });

  describe('once', () => {
  it('should call listener only once', () => {
    let count = 0;

    eventBus.once('test', () => count++);

    eventBus.emit('test');
    eventBus.emit('test');
    eventBus.emit('test');

    assert.equal(count, 1);
  });
  });

  describe('removeListener', () => {
  it('should remove listener', () => {
    let count = 0;
    const listener = () => count++;

    eventBus.on('test', listener);
    eventBus.emit('test');

    eventBus.removeListener('test', listener);
    eventBus.emit('test');

    assert.equal(count, 1);
  });
  });

  describe('async emit', () => {
  it('should wait for all async listeners', async () => {
    const results = [];

    eventBus.on('test', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    results.push(1);
    });

    eventBus.on('test', async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    results.push(2);
    });

    await eventBus.emitAsync('test');

    assert.equal(results.length, 2);
    assert.equal(results[0], 1);
    assert.equal(results[1], 2);
  });

  it('should handle mixed sync and async listeners', async () => {
    const results = [];

    eventBus.on('test', () => {
    results.push(1);
    });

    eventBus.on('test', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    results.push(2);
    });

    await eventBus.emitAsync('test');

    assert.equal(results.length, 2);
  });
  });

  describe('event history', () => {
  it('should record events', () => {
    eventBus.emit('event1', { data: 1 });
    eventBus.emit('event2', { data: 2 });

    const history = eventBus.getHistory();

    assert.equal(history.length, 2);
    assert.equal(history[0].name, 'event1');
    assert.equal(history[1].name, 'event2');
  });

  it('should limit history size', () => {
    eventBus.setHistoryLimit(3);

    eventBus.emit('event1');
    eventBus.emit('event2');
    eventBus.emit('event3');
    eventBus.emit('event4');

    const history = eventBus.getHistory();

    assert.equal(history.length, 3);
  });

  it('should disable history when limit is 0', () => {
    eventBus.setHistoryLimit(0);

    eventBus.emit('event1');
    eventBus.emit('event2');

    const history = eventBus.getHistory();

    assert.equal(history.length, 0);
  });

  it('should clear history', () => {
    eventBus.emit('event1');
    eventBus.emit('event2');

    eventBus.clearHistory();

    const history = eventBus.getHistory();

    assert.equal(history.length, 0);
  });

  it('should get limited history', () => {
    for (let i = 0; i < 20; i++) {
    eventBus.emit(`event${i}`);
    }

    const history = eventBus.getHistory(5);

    assert.equal(history.length, 5);
  });
  });

  describe('event names', () => {
  it('should get all event names', () => {
    eventBus.on('event1', () => {});
    eventBus.on('event2', () => {});
    eventBus.on('event1', () => {});

    const names = eventBus.getEventNames();

    assert.equal(names.length, 2);
    assert(names.includes('event1'));
    assert(names.includes('event2'));
  });

  it('should get listener count', () => {
    eventBus.on('event1', () => {});
    eventBus.on('event1', () => {});
    eventBus.on('event2', () => {});

    assert.equal(eventBus.getListenerCount('event1'), 2);
    assert.equal(eventBus.getListenerCount('event2'), 1);
  });
  });

  describe('stats', () => {
  it('should return stats', () => {
    eventBus.on('event1', () => {});
    eventBus.on('event1', () => {});
    eventBus.on('event2', () => {});

    const stats = eventBus.getStats();

    assert.equal(stats.events, 2);
    assert.equal(stats.totalListeners, 3);
  });
  });
});

/**
 * ServiceContainer 单元测试
 */

const assert = require('assert');
const { ServiceContainer } = require('../../../lib/core/ServiceContainer');

describe('ServiceContainer', () => {
  let container;

  beforeEach(() => {
  container = new ServiceContainer();
  });

  describe('register and resolve', () => {
  it('should register and resolve a service', () => {
    container.register('test-service', () => ({ value: 42 }));

    const service = container.resolve('test-service');

    assert.equal(service.value, 42);
  });

  it('should throw error for non-existent service', () => {
    assert.throws(() => {
    container.resolve('non-existent');
    }, /Service 'non-existent' not registered/);
  });

  it('should throw error if factory is not a function', () => {
    assert.throws(() => {
    container.register('bad-service', {});
    }, /must be a function/);
  });
  });

  describe('singleton services', () => {
  it('should return same instance for singleton', () => {
    const id = Math.random();
    container.register('singleton', () => ({ id }), true);

    const instance1 = container.resolve('singleton');
    const instance2 = container.resolve('singleton');

    assert.equal(instance1.id, instance2.id);
    assert.strictEqual(instance1, instance2);
  });

  it('should register as singleton by default', () => {
    container.register('service', () => ({ id: Math.random() }));

    const instance1 = container.resolve('service');
    const instance2 = container.resolve('service');

    assert.strictEqual(instance1, instance2);
  });

  it('should use singleton() helper method', () => {
    const id = Math.random();
    container.singleton('service', () => ({ id }));

    const instance1 = container.resolve('service');
    const instance2 = container.resolve('service');

    assert.strictEqual(instance1, instance2);
  });
  });

  describe('transient services', () => {
  it('should return different instances for non-singleton', () => {
    container.register('transient', () => ({ id: Math.random() }), false);

    const instance1 = container.resolve('transient');
    const instance2 = container.resolve('transient');

    assert.notEqual(instance1.id, instance2.id);
    assert.notStrictEqual(instance1, instance2);
  });

  it('should use transient() helper method', () => {
    container.transient('service', () => ({ id: Math.random() }));

    const instance1 = container.resolve('service');
    const instance2 = container.resolve('service');

    assert.notStrictEqual(instance1, instance2);
  });
  });

  describe('aliases', () => {
  it('should resolve service by alias', () => {
    container.register('original', () => ({ value: 42 }));
    container.alias('original', 'alias');

    const service = container.resolve('alias');

    assert.equal(service.value, 42);
  });

  it('should throw error for non-existent original service', () => {
    assert.throws(() => {
    container.alias('non-existent', 'alias');
    }, /Cannot create alias for non-existent service/);
  });

  it('should support chain alias calls', () => {
    container.register('service', () => ({ value: 42 }));
    container.alias('service', 'alias1');
    container.alias('service', 'alias2');

    const service1 = container.resolve('alias1');
    const service2 = container.resolve('alias2');

    assert.equal(service1.value, 42);
    assert.equal(service2.value, 42);
  });
  });

  describe('dependency injection', () => {
  it('should pass container to factory function', () => {
    container.register('dependency', () => ({ name: 'dependency' }));
    container.register('service', (c) => {
    const dep = c.resolve('dependency');
    return { dependency: dep };
    });

    const service = container.resolve('service');

    assert.equal(service.dependency.name, 'dependency');
  });

  it('should support nested dependencies', () => {
    container.register('level3', () => ({ value: 3 }));
    container.register('level2', (c) => ({
    level3: c.resolve('level3')
    }));
    container.register('level1', (c) => ({
    level2: c.resolve('level2')
    }));

    const service = container.resolve('level1');

    assert.equal(service.level2.level3.value, 3);
  });
  });

  describe('boot and lifecycle', () => {
  it('should boot container and initialize all singletons', () => {
    let service1Created = false;
    let service2Created = false;

    container.register('service1', () => {
    service1Created = true;
    return {};
    });
    container.register('service2', () => {
    service2Created = true;
    return {};
    });
    container.register('transient', () => ({}), false);

    container.boot();

    assert(service1Created);
    assert(service2Created);
    assert(container.isBooted());
  });

  it('should prevent registration after boot', () => {
    container.boot();

    assert.throws(() => {
    container.register('service', () => ({}));
    }, /Cannot register service/);
  });

  it('should throw error on boot if service factory fails', () => {
    container.register('failing', () => {
    throw new Error('Factory failed');
    });

    assert.throws(() => {
    container.boot();
    }, /Error resolving service/);
  });
  });

  describe('utilities', () => {
  it('should check if service is registered', () => {
    container.register('service', () => ({}));

    assert(container.has('service'));
    assert(!container.has('non-existent'));
  });

  it('should check if service is singleton', () => {
    container.register('singleton', () => ({}), true);
    container.register('transient', () => ({}), false);

    assert(container.isSingleton('singleton'));
    assert(!container.isSingleton('transient'));
  });

  it('should get all services', () => {
    container.register('service1', () => ({}));
    container.register('service2', () => ({}));

    const services = container.getServices();

    assert(services.includes('service1'));
    assert(services.includes('service2'));
  });

  it('should get container stats', () => {
    container.register('service1', () => ({}), true);
    container.register('service2', () => ({}), false);

    const stats = container.getStats();

    assert.equal(stats.registered, 2);
    assert.equal(stats.singletons, 1);
    assert.equal(stats.booted, false);

    container.boot();

    const statsAfterBoot = container.getStats();
    assert.equal(statsAfterBoot.resolved, 1);
    assert.equal(statsAfterBoot.booted, true);
  });
  });

  describe('flush', () => {
  it('should clear all services', () => {
    container.register('service', () => ({}));
    container.boot();

    const statsBefore = container.getStats();
    assert.equal(statsBefore.registered, 1);

    container.flush();

    const statsAfter = container.getStats();
    assert.equal(statsAfter.registered, 0);
    assert.equal(statsAfter.resolved, 0);
    assert.equal(statsAfter.booted, false);
  });
  });

  describe('chaining', () => {
  it('should support method chaining', () => {
    const result = container
    .register('service1', () => ({}))
    .register('service2', () => ({}))
    .singleton('service3', () => ({}))
    .alias('service1', 'alias');

    assert(result === container);
    assert.equal(container.getServices().length, 3);
  });
  });
});

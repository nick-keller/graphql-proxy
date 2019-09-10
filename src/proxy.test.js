const { createProxy } = require('./index')

describe('createProxy arguments checks', () => {
  test('non function getter', () => {
    expect(() => createProxy({ getters: { foo: 'bar', }, })).toThrow(
      'Proxy getters should be functions, ' +
      'but getter "foo" is of type string.'
    )
  })

  test('getter with arguments', () => {
    expect(() => createProxy({ getters: { foo(bar) { return bar }, }, })).toThrow(
      'Proxy getters should not accept any arguments, ' +
      'but getter "foo" accepts 1 argument(s).'
    )
  })

  test('arrow getter', () => {
    expect(() => createProxy({ getters: { foo: () => 'bar', }, })).toThrow(
      'Proxy getters should not be arrow functions, ' +
      'but getter "foo" is. ' +
      'Replace its declaration with "foo() {...}" or "foo: function() {...}" in order to enable "this" binding.'
    )
  })

  test('valid getters', () => {
    expect(() => createProxy({ getters: { foo: function() { return 'bar' }, }, })).not.toThrow()
    expect(() => createProxy({ getters: { foo() { return 'bar' }, }, })).not.toThrow()
  })

  test('non function method', () => {
    expect(() => createProxy({ methods: { foo: 'bar', }, })).toThrow(
      'Proxy methods should be functions, ' +
      'but method "foo" is of type string.'
    )
  })

  test('arrow method', () => {
    expect(() => createProxy({ methods: { foo: () => 'bar', }, })).toThrow(
      'Proxy methods should not be arrow functions, ' +
      'but method "foo" is. ' +
      'Replace its declaration with "foo() {...}" or "foo: function() {...}" in order to enable "this" binding.'
    )
  })

  test('valid methods', () => {
    expect(() => createProxy({ methods: { foo: function() { return 'bar' }, }, })).not.toThrow()
    expect(() => createProxy({ methods: { foo(bar) { return bar }, }, })).not.toThrow()
  })
})

test('works with promises', async() => {
  const User = createProxy()
  const user = new User('foo')

  await expect(Promise.resolve(user)).resolves.toBe(user)
})

test('properties', () => {
  const User = createProxy({ entityType: 'User', })
  const user = new User('foo')

  expect(user.entityType).toBe('User')
  expect(user.id).toBe('foo')
})

test('methods', () => {
  const foo = jest.fn(function(suffix) {
    return this.id + suffix
  })

  const Entity = createProxy({ methods: { foo, }, })
  const entity = new Entity('baz')

  expect(entity.foo('qux')).toBe('bazqux')
  expect(foo).toHaveBeenCalledWith('qux')
})

test('id is required', () => {
  const User = createProxy({ entityType: 'User', })
  expect(() => new User()).toThrow('Proxy should be instantiated with an id, but got: undefined.')
})

describe('getters caching', () => {
  test('synchronous', () => {
    const foo = jest.fn(function() {
      return 'bar'
    })

    const User = createProxy({ getters: { foo, }, })
    const user = new User('baz')

    expect(user.foo).toBe('bar')
    expect(user.foo).toBe('bar')
    expect(foo).toHaveBeenCalledTimes(1)
  })

  test('asynchronous', async() => {
    const foo = jest.fn(function() {
      return Promise.resolve('bar')
    })

    const User = createProxy({ getters: { foo, }, })
    const user = new User('baz')

    const result1 = user.foo
    const result2 = user.foo

    expect(result1).toBe(result2)
    await expect(result1).resolves.toBe('bar')
    expect(foo).toHaveBeenCalledTimes(1)
  })
})

describe('dataValues getter', () => {
  test('loader is called', async() => {
    const userLoader = { load: jest.fn() }
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo', { loaders: { User: userLoader, }})

    userLoader.load.mockReturnValue(Promise.resolve({ name: 'bar', }))

    await expect(user.dataValues).resolves.toEqual({ name: 'bar', })
    expect(userLoader.load).toHaveBeenCalledWith('foo')
  })

  test('Entity does not exist', async() => {
    const userLoader = { load: jest.fn() }
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo', { loaders: { User: userLoader, }})

    userLoader.load.mockReturnValue(Promise.resolve(undefined))

    await expect(user.dataValues).rejects.toThrow('Entity User with id "foo" does not exist.')
  })

  test('magic dataValues getter', async() => {
    const userLoader = { load: jest.fn() }
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo', { loaders: { User: userLoader, }})

    userLoader.load.mockReturnValue(Promise.resolve({ name: 'bar', }))

    await expect(user.name).resolves.toBe('bar')
  })

  test('loader.load is not a function', async() => {
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo', { loaders: { User: true, }})

    await expect(user.dataValues).rejects.toThrow(
      'The proxy entityLoader.load should be a function. ' +
      'Either make sure the "entityLoader" getter returns a dataLoader, ' +
      'or override the default "dataValues" getter with your own logic.'
    )
  })
})

describe('entityLoader getter', () => {
  test('no loaders', async() => {
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo')

    expect(() => user.entityLoader).toThrow(
      'The proxy context.loaders is not defined. ' +
      'Either pass a "loaders" object in the context when instantiating an entity, ' +
      'or override the default "entityLoader" getter with your own logic.'
    )
  })

  test('no loader for entity', async() => {
    const User = createProxy({ entityType: 'User', })
    const user = new User('foo', { loaders: {}})

    expect(() => user.entityLoader).toThrow(
      'No loaders is defined for proxy User. ' +
      'Either make sure context.loaders.User is defined, ' +
      'or override the default "entityLoader" getter with your own logic.'
    )
  })
})

describe('exists getter', () => {
  test('exists', async() => {
    const User = createProxy({ getters: { dataValues() { return Promise.resolve({ name: 'bar' })}}, })
    const user = new User('foo')

    await expect(user.exists).resolves.toBe(true)
  })

  test('does not exist', async() => {
    const User = createProxy({ getters: { dataValues() { return Promise.reject()}}, })
    const user = new User('foo')

    await expect(user.exists).resolves.toBe(false)
  })
})

describe('assertExists method', () => {
  test('exists', async() => {
    const User = createProxy({ getters: { dataValues() { return Promise.resolve({ name: 'bar' })}}, })
    const user = new User('foo')

    await expect(user.assertExists()).resolves.not.toThrow()
  })

  test('does not exist', async() => {
    const User = createProxy({ getters: { dataValues() { return Promise.reject(new Error('Does not exist'))}}, })
    const user = new User('foo')

    await expect(user.assertExists()).rejects.toThrow('Does not exist')
  })
})

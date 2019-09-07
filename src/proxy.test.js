import { createProxy } from './index'

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

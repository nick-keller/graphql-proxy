# Getting Started
# Creating proxy classes

```js
const User = createProxy({ entityType: 'User' })
const user = new User(46)

console.log(user.id) // => 46
console.log(user.entityType) // => 'User'
```

Instantiating is very cheap, no database calls are made. 
You can instantiate a proxy with an id that is not in the database and it will still work. 
Checks are only executed as needed when you try to access data that should be in the database for instance.

You can view this step as simply creating an object with an `id` and `entityType` property:
```js
const user = { id: 46, entityType: 'User' }
```

# Getters
Getters are the core functionality of proxies. 
They are functions that do not take any argument and are called like a property:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    foo() {
      return 'bar-' + this.id
    },
    async baz() {
      const qux = await Promise.resolve('qux')
      return qux + '-' + this.foo
    }
  }
})

const user = new User(46)

console.log(user.foo) // => 'bar-46'
console.log(await user.baz) // => 'qux-bar-46'
```

## Binding of `this`
Getters are bound with `this` as the proxy itself. 
It means that a getter can access other getters / methods / properties as shown in the example.

For the binding to work you must **not** use arrow functions. Valid syntax are:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    foo() {
      //...
    },
    bar: function() {
      //...
    } 
  }
})
```

## Caching
Getters are automatically memoized, they are only called when accessed the first time. 
Following calls return the same cached value:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    foo() {
      console.log('foo called!') // called only once
      return Promise.resolve('foo')
    },
    bar() {
      console.log('bar called!') // never called
      return Promise.resolve('bar')
    }
  }
})

const user = new User(46)

const promiseA = user.foo
const promiseB = user.foo
assert(promiseA === promiseB)
```

You can have expensive computation in your getters and have them called at different 
places in your application without performance impact. Caching is built in and completely transparent for you.

This means that a getter must always return the same value. 
If you want your getter to return a different value after every call you should use a method instead.

## Clearing cache
After a mutation you might want to clear the getters cache:
```js
const user = new User(46)
user.foo // => foo() is called
user.foo // => cached value is returned
...

user.clearCache()
user.foo // => foo() is called
user.foo // => cached value is returned
...
```

Clearing the cache does not re-build it, values that where previously cached will not be automatically re-computed.

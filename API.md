
# Creating proxy classes

```js
const User = createProxy({ entityType: 'User' })
const user = new User(46)

console.log(user.id) // => 46
console.log(user.entityType) // => 'User'
```

Instantiating is very cheap since no database calls are made. 
It means that you can instantiate a proxy with an id that is not actually in the database 
without triggering any errors.

You can picture this process as simply creating an object with an `id` and `entityType` property:
```js
const user = { id: 46, entityType: 'User' }
```

This is why the `Query.article` resolver is so fast in the examples above. This behaviour
is is what makes parallelization and lazy-loading possible.

# Context
When instantiating a proxy you can pass a context as the second parameter:
 
```js
const user = new User(46, { appId: 'foo' })

console.log(user.context.appId) // => 'foo'
```

The context is most often used to pass a database connexions, loaders, and so on. 
Unlike what is demonstrated in the example, you should never have to access the context this way, 
it will most likely only be used from within getter and methods.

# Getting data from the database
GraphQL-Proxy works very well with DataLoader. 
All you have to do is pass a `loaders` object in the context with the same key as the `entityType`:
```js
const userLoader = new DataLoader(/* ... */)
const User = createProxy({ entityType: 'User' })

// user is instantiated, no database calls are executed
const user = new User(46, { loaders: { User: userLoader }})

// userLoader.load(46) is called which execute a database call 
console.log(await user.dataValues) // => { name: 'Elon', email: 'elon@spacex.com' }
```

As you can see the database call is only executed when you actually need it. 
This is why `dataValues` is a Promise. It might already be resolved if it was called earlier 
in your application, but you should not have to known that. 
This is why `dataValues` **always** return a promise.

This behaviour might seam strange at first, we are used to `await` when instantiating our entities,
not when getting their values. But you will get adjusted to it very quickly when you start to see the benefits! 

You can access individual fields of an entity like this:
```js
const name = user.dataValues.then(({ name }) => name) 
console.log(await name) // => 'Elon'

// Or use the shorthand getter
console.log(await user.name) // => 'Elon'
```

# Getters
Getters are the core functionality of proxies. 
You have already encountered the `dataValues` getter which is built-in for you.
You can add you own getters, they are functions that do not take any argument and are called 
like a property:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    encryptedId() {
      return encrypt(this.id)
    },
    async fullName() {
      return await this.firstName + ' ' + await this.lastName
    }
  }
})

const user = new User(46)

console.log(user.encryptedId) // => 'f7P_a'
console.log(await user.fullName) // => 'Elon Musk'
```

## Binding of `this`
Getters are bound with `this` as the proxy itself. 
It means that a getter can access context / other getters / methods / properties.

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
locations in your application with no performance impact. Caching is built in and completely transparent for you.

This means that a getter must always return the same value. 
If you want your getter to return a different value after every call you should use a method instead.

### Clearing cache
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

## Built in getters
### `entityLoader`
### `dataValues`
### `exists`

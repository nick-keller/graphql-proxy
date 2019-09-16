# API reference

## Install
```
npm i @nick-keller/graphql-proxy
```

## Creating proxy classes

```js
import { createProxy } from '@nick-keller/graphql-proxy'

const User = createProxy({ entityType: 'User' })
const user = new User(46)

console.log(user.id) // => 46
console.log(user.entityType) // => 'User'
```

Instantiating is very cheap since no database calls are made. 
It means that you can instantiate a proxy with an id that is not actually in the database 
without triggering any errors.

## Context
When instantiating a proxy you can pass a context as the second parameter:
 
```js
const user = new User(46, { appId: 'foo' })

console.log(user.context.appId) // => 'foo'
```

The context is most often used to pass a database connexion, loaders, and so on. 
Unlike what is demonstrated in the example, you should never have to access the context this way, 
it will most likely only be used from within getter and methods.

## Getting data from the database
GraphQL-Proxy works very well with DataLoader. 
All you have to do is pass a `loaders` object in the context with the same key as the `entityType`:
```js
const userLoader = new DataLoader(/* ... */)
const User = createProxy({ entityType: 'User' })

const user = new User(46, { loaders: { User: userLoader }})

// userLoader.load(46) is called
console.log(await user.dataValues) // => { name: 'Elon', email: 'elon@spacex.com' }
```

The database call is only executed when calling `user.dataValues` not when instantiating the user. 
This is why `dataValues` is a Promise. It might already be resolved if it was called earlier 
in your application, but it will still return a Promise.

This behaviour might seam strange at first, we are used to `await` when instantiating our entities,
not when getting their values. If do not understand why, try reading the [introduction](README.md).

You can also access individual fields of an entity like this:
```js
const name = user.dataValues.then(({ name }) => name) 
console.log(await name) // => 'Elon'

// Or use the shorthand getter
console.log(await user.name) // => 'Elon'
```

## Getters
Getters are the core functionality of proxies. 
You have already encountered the `dataValues` getter which is built-in for you.
You can add you own getters, they are functions that do not take any argument and are called 
like a property:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    encryptedId() {
      return encryptId(this.id)
    },
    async fullName() {
      return await this.firstName + ' ' + await this.lastName
    },
    async fullNameUpper() {
      return (await this.fullName).toUpperCase()
    } 
  }
})

const user = new User(46)

console.log(user.encryptedId) // => 'f7P_a'
console.log(await user.fullName) // => 'Elon Musk'
console.log(await user.fullNameUpper) // => 'ELON MUSK'
```

### Binding of `this`
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

### Caching
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

#### Clearing cache
After a mutation you might want to clear the getters cache:
```js
const user = new User(46)

console.log(await user.name) // => 'Elon' (userLoader.load(46) is called)
console.log(await user.name) // => 'Elon' (cached value)

await updateUserName(46, 'Gwynne')

console.log(await user.name) // => 'Elon' (cached value)

user.clearCache()
console.log(await user.name) // => 'Gwynne' (userLoader.load(46) is called)
console.log(await user.name) // => 'Gwynne' (cached value)
```

Clearing the cache also clears the id from the loader: `userLoader.clear(46)` is called.

### Built in getters
All proxies come with some built in getters for your convenience.
You can override all built-in getter to implement your own logic if needed.

#### `entityLoader`
This getter is responsible for returning the DataLoader of the entity. It is used by `dataValues` and `clearCache()`.
By default it returns `this.context.loaders[this.entityType]`.

You can override this getter if you need custom logic to retrieve the loader:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    entityLoader() {
      if (this.context.virtual) {
        return this.context.loaders.virtualUserLoader
      }
      return this.context.loaders.userLoader
    }
  }
})
```
#### `dataValues`
This getter is responsible for fetching the data and throwing an error if the data could not be found.
By default it uses the DataLoader from `this.entityLoader`.
#### `exists`
This getter returns a boolean. When `this.dataValues` throws an error it return `false` otherwise it return `true`.

```js
const user = new User(46)

if (!await user.exists) {
  return null
}

return user.naem
```

#### magic property getters
When you try to call a getter that does not exist, the proxy will first call `dataValues`
and try to get the property from the returned object:

```js
console.log(await user.name)

// is equivalent to:
console.log(await user.dataValues.then(({ name }) => name))
```

Of course you can override a magic getter like so:
```js
const User = createProxy({ 
  entityType: 'User',
  getters: {
    async name() {
      // You have to use `dataValues`, calling `this.name` will trigger an infinite loop
      const actualName = await this.dataValues.then(({ name }) => name)

      return actualName.toUpperCase()
    }
  }
})
```

## Methods

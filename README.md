# GraphQL Proxy
GraphQL Proxy is a generic utility that provides an elegant and consistent API for 
fetching and computing data in an optimised way via parallelization, lazy-loading, and caching.

While not mandatory, it is recommended to use GraphQL Proxy with 
[DataLoader](https://github.com/graphql/dataloader) which provides batching and 
caching at the data fetching layer.

## Parallelization
When building a GraphQL API you usually end-up writing resolvers like so:
```js
const resolvers = {
  Query: {
    article: (_, { id }, { articleLoader }) => articleLoader.load(id)
  },
  Article: {
    comments: async(article, _, { commentLoader }) => {
      const commentIds = await knex('comments').where({ articleId: article.id }).pluck('id')
      return commentLoader.loadMany(commentIds)
    }
  }
}
```
And when resolving this query:
```graphql
{
  article(id: 46) {
    title
    comments {
      message
    } 
  }
}
```
Resolvers are executed in this order:
```
|---------| Query.article (1 database call)
          |-| Article.title (default resolver)
          |-----------------| Article.comments (2 database call)
                            |-| Comment.message (default resolver)
```

The problem here is fairly obvious, the 3 database calls are run sequentially which makes the request
slower than it could have been. The `Article.comments` resolver only needs the article's id, which is 
available right from the start.

With GraphQL Proxy you get parallelization out of the box, resolvers execution now looks like this:
```
|-| Query.article
  |---------| Article.title (1 database call)
  |---------| Article.comments (1 database call)
            |---------| Comment.message (1 database call)
                       //////// Amount of time spared
```

## Lazy-loading
Now let's take the same example but only querying the comment's ids:
```graphql
{
  article(id: 46) {
    comments {
      id
    } 
  }
}
```
With the naive approach, the resolvers execution will look like this:
```
|---------| Query.article (1 database call)
          |-----------------| Article.comments (2 database call)
                            |-| Comment.id (default resolver)
```

This is a classic example where we end up executing useless database calls 
that slow down the entire request and puts unnecessary stress on the database.

With GraphQL Proxy you only execute database calls when needed, which in this particular case
would end up executing only 1 query instead of 3:
```
|-| Query.article
  |---------| Article.comments (1 database call)
            |-| Comment.id
               //////////////// Amount of time spared
```

## Caching
Caching at the data fetching layer is crucial and is tackled by [DataLoader](https://github.com/graphql/dataloader).
GraphQL Proxy acts on top of it to tackles caching at the computation layer.

It means that computation-heavy functions on your entities are executed at most once throughout your application,
even when called on multiple, unrelated parts.

Cherry on the cake, GraphQL Proxy makes it trivial to cache the result of those functions in a data store like 
Redis without impacting your code.

# Getting Started
Install GraphQL Proxy using npm.
```
npm i graphql-proxy
```

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

This is why the `Query.article` resolver is so fast in the examples above. This behaviour
is is what makes parallelization and lazy-loading possible.

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
locations in your application with no performance impact. Caching is built in and completely transparent for you.

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

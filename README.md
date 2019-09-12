# GraphQL-Proxy
GraphQL-Proxy is a generic utility that provides an elegant and consistent API for 
fetching and computing data in an optimised way via parallelization, lazy-loading, and caching.

While not mandatory, it is recommended to use GraphQL-Proxy with 
[DataLoader](https://github.com/graphql/dataloader) which provides batching and 
caching at the data fetching layer.

If you are new to GraphQL-Proxy you should read the introduction, otherwise you can skip right to the [getting started](#getting-started)

## Introduction
### Your GraphQL backend is not optimized
When building a GraphQL API, a naive approach is to write resolvers like so:
```js
const resolvers = {
  Query: {
    article: (_, { id }, { articleLoader }) => articleLoader.load(id)
  },
  Article: {
    comments: async(article, _, { commentLoader, articleCommentIdsLoader }) => {
      const commentIds = await articleCommentIdsLoader.load(article.id)
      return commentLoader.loadMany(commentIds)
    }
  }
}
```
It is pretty intuitive and easy to reason about. Now let's run our resolvers against this query:
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
If you trace the execution time of each resolver you get a graph like this one:
```
|---------| Query.article (1 database call)
          |-| Article.title (default resolver)
          |-----------------| Article.comments (2 database call)
                            |-| Comment.message (default resolver)
```

The problem here is fairly obvious, the 3 database calls are run sequentially which makes the request
slower than it could have been. The `Article.comments` resolver only needs the article's id to resolve, 
but we wait for the entire article to be fetched first. 

We will see how to solve this parallelization issue,
but first we need to address a second issue we face with this naive approach: over-fetching. 
To illustrate this, let's only querying the comment's ids:
```graphql
{
  article(id: 46) {
    comments {
      id
    } 
  }
}
```
Now tracing looks like this:
```
|---------| Query.article (1 database call)
          |-----------------| Article.comments (2 database call)
                            |-| Comment.id (default resolver)
```

So we end up doing 3 queries to the database where one would have been enough.
This is a classic example where we end up executing useless database calls 
that slow down the entire request and puts unnecessary stress on the infrastructure.

### Thinking with proxies
A better approach is to fetch data at field-level in your resolvers:
```js
const resolvers = {
  Query: {
    article: (_, { id }) => id
  },
  Article: {
    id: (articleId) => articleId,
    title: async (articleId, _, { articleLoader }) => {
      const { title } = await articleLoader.load(articleId)
      return title
    },
    comments: async (articleId, _, { articleCommentIdsLoader }) => {
      return articleCommentIdsLoader.load(articleId)
    },
  },
  Comment: {
    id: (commentId) => commentId,
    message: async(commentId, _, { commentLoader }) => {
      const { message } = await commentLoader.load(commentId)
      return message
    }
  }
}
```

This is only possible thanks to DataLoader, without it we might query the same thing multiple times.
But with batching and caching this is definitely not an issue.

Let's run our first query once again. Resolvers tracing now looks like this:
```
|-| Query.article
  |---------| Article.title (1 database call)
  |---------| Article.comments (1 database call)
            |---------| Comment.message (1 database call)
                       //////// Amount of time spared
```

You can clearly see that parallelization is working and that we spared quite some time 
to the overall request execution time.

With this pattern you also get lazy-loading for free, which means that you do not over-fetch like in our previous example.
Let's run the second query and trace our resolvers execution time:
```
|-| Query.article
  |---------| Article.comments (1 database call)
            |-| Comment.id
               //////////////// Amount of time spared
```
As you can see we only execute 1 database call instead of 3, 
and significantly reduce the overall request execution time.

### Computed fields
Let's imagine that you have a fancy heuristic that computes the amount of time it takes to read an article.
You just have to update your schema and add a resolver to make it available through your API:
 
```js
const resolvers = {
  Article: {
    timeToRead: async (articleId, _, { articleLoader }) => {
      const { content } = await articleLoader.load(articleId)
      return computeTimeToRead(content)
    },
  },
}
```

This solution works well, but if you want to compute the `timeToRead` somewhere else in your application,
let's say for sorting purposes, you will have to call `computeTimeToRead` again and do the computation twice.

We obviously need to put some cache in place. A global Lodash `memoize` would work but the cache would keep inflating 
until the server is re-started using up precious memory space. 
We need to memoize our function at a per-request level and pass it to the context:

```js
const resolvers = {
  Article: {
    timeToRead: async (articleId, _, { articleLoader, computeTimeToRead }) => {
      const { content } = await articleLoader.load(articleId)
      return computeTimeToRead(content)
    },
  },
}
```

Now if you want to cache this information in a store like Redis you will have to completely refactor your code.

```js
const createComputeTimeToRead = (articleLoader) => memoize(async(articleId) => {
  const redisValue = await getRedisValue(`article:${articleId}:timeToRead`)

  if (redisValue !== null) {
    return redisValue  
  }

  const { content } = await articleLoader.load(articleId)
  const timeToRead = computeTimeToRead(content)

  await setRedisValue(`article:${articleId}:timeToRead`, timeToRead)
  return timeToRead
})

// When creating the context for each request
const context = {
  // ...
  articleLoader,
  computeTimeToRead: createComputeTimeToRead(articleLoader),
}

const resolvers = {
  Article: {
    timeToRead: async (articleId, _, { computeTimeToRead }) => {
      return computeTimeToRead(articleId)
    },
  },
}
```

You will now have to do this for every computed field that you wish to cache.

This is where GraphQL-Proxy comes into play.

# Getting Started
Install GraphQL-Proxy using npm.
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

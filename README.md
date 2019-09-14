# GraphQL-Proxy
![npm](https://img.shields.io/npm/v/@nick-keller/graphql-proxy)

GraphQL-Proxy is a generic utility that provides an elegant and consistent API for 
fetching and computing data in an optimised way via parallelization, lazy-loading, and caching.

GraphQL-Proxy is perfectly integrated with 
[DataLoader](https://github.com/graphql/dataloader) which provides batching and 
caching at the data fetching layer.

If you are new to GraphQL-Proxy you should read this introduction, 
otherwise you can skip right to the [getting started](#getting-started) section or to the [API documentation](API.md).

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

We will see how to solve this parallelization issue next,
but first we need to address a second issue we face with this naive approach: over-fetching. 
To illustrate what this means, let's only querying the comment's ids:
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

We end up doing 3 queries to the database where one would have been enough.
This is a classic example where we end up executing useless database calls 
that slow down the entire request and puts unnecessary stress on the infrastructure.

### Re-thinking resolvers
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
    content: async (articleId, _, { articleLoader }) => {
      const { content } = await articleLoader.load(articleId)
      return content
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

You might be worry that when querying the title and the content we would end up fetching the article twice,
but thanks to DataLoader queries are de-dupe and cached precisely to avoid this issue.

Let's run our first query once again and look at tracing results:
```
|-| Query.article
  |---------| Article.title (1 database call)
  |---------| Article.comments (1 database call)
            |---------| Comment.message (1 database call)
                       //////// Amount of time spared
```

You can clearly see that some parallelization is going on and that we reduced the response time significantly.

With this pattern you also get lazy-loading for free, which means that you do not over-fetch like in our previous example.
Let's run the second query once again to illustrate:
```
|-| Query.article
  |---------| Article.comments (1 database call)
            |-| Comment.id
               //////////////// Amount of time spared
```
As you can see we only executed 1 database call instead of 3, 
and significantly reduce the overall response time.

The only downside to this pattern is clarity and repetitiveness. And this is where GraphQL-Proxy comes in.
GraphQL-Proxy is simply a thin wrapper around this pattern that allows you to write clean code and separate concerns
in your application.

But before we dive into how to implement GraphQL-Proxy in your application there is one last topic we need to cover, computed fields!

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
What we need instead is to memoize our function at a per-request level and pass it to the context:

```js
const resolvers = {
  Article: {
    timeToRead: async (articleId, _, { articleLoader, computeTimeToReadMemoized }) => {
      const { content } = await articleLoader.load(articleId)
      return computeTimeToReadMemoized(content)
    },
  },
}
```

With this in place we are guaranteed to compute `timeToRead` at most once per request per article.
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
It works but it's not the ideal solution:
- code is split into 3 different places across your application
- not scalable: adding a new field requires a lot of copy-paste
- the `createComputeTimeToRead` function does too many things

Now that we have the big picture we can dive right into implementing GraphQL-Proxy!

# Getting Started
Install GraphQL-Proxy using npm.
```
npm i graphql-proxy
```

## Creating proxy classes

In the solution we described, the `Query.article` resolver returns only the id and no database calls is executed.
With GraphQL-Proxy we use proxies instead, proxies are just thin wrappers around your ids.

```js
// Before
const resolvers = {
  Query: {
    article: (_, { id }) => id
  },
  Article: {
    id: (articleId) => articleId
  }
}

// After
const Article = createProxy({ entityType: 'Article' })

const resolvers = {
  Query: {
    article: (_, { id }) => new Article(id)
  },
  Article: {
    id: (article) => article.id 
  }
}
```

The `Article.id` now receives an `Article` proxy and returns the id of that 
proxy instead of simply returning the id it receives. 
And because this behaviour is exactly what the default resolver does in GraphQL, 
we can omit the id resolver altogether:

```js
const Article = createProxy({ entityType: 'Article' })

const resolvers = {
  Query: {
    article: (_, { id }) => new Article(id)
  }
}
```

Remember that doing `new Article(id)` does not actually do anything, no database calls, no checks. 
Just like when we simply returned the id but wrapped in a class. 

## Fetching data
We are now going to implement the `title` and `content` resolvers. 
We need to tell our proxy how to fetch data from our database using DataLoader.
The first thing you want to do is adding your loader to your GraphQL context:
```js
const articleLoader = new DataLoader(/*...*/)

const context = {
  loaders: {
    Article: articleLoader
  }
}
```

And when instantiating an article, simply forward the loaders from the GraphQL context to the proxy context:
```js
const Article = createProxy({ entityType: 'Article' })

const resolvers = {
  Query: {
    article: (_, { id }, { loaders }) => new Article(id, { loaders })
  }
}
```

And that is it, the `title` and `content` resolvers are up and running!

It looks magical but the mechanisms behind are trivials. 
First we did not write any resolvers, which is equivalent to writing the default resolver by hand:
```js
const resolvers = {
  Article: {
    id: (article) => article.id,
    title: (article) => article.title,
    content: (article) => article.content,
  }
}
```

`article.id` simply returns the value we passed when instantiating the proxy without any database call.

We did not specify anything for `article.title` and `article.content` so the proxy falls-back to
getting those values from the database using the `loaders` object we passed to the context.

This works because we followed the following convention:
- When instantiating the article we passed a `loaders` object to the context.
- The `loaders` object has a key equal to `entityType` of `createProxy({ entityType })` with a DataLoader as value.
- The DataLoader `.load(id)` function returns an object with the keys `title` and `content`.

Remember that data-fetching occurs at field-level, this means that `article.title` and `article.content` are promises:
```js
const article = new Article(id, { loaders })
console.log((await article.title).toUpperCase())
```

## Adding getters
In this section we will implement the `Article.comments` resolver. 
Just like `article.title` is a Promise that resolves to the title of the article, we expect `article.comments`
to be a Promise that resolves to an array of... `Comment` proxies of course!

So the first thing to do is to create the `Comment` proxy class:
```js
const Comment = createProxy({ entityType: 'Comment' })
```
We can now add the `articleCommentIdsLoader` and `commentLoader` loaders to the GraphQL context:
```js
const articleLoader = new DataLoader(/*...*/)
const commentLoader = new DataLoader(/*...*/)
const articleCommentIdsLoader = new DataLoader(/*...*/)

const context = {
  loaders: {
    Article: articleLoader,
    Comment: commentLoader,
    articleCommentIdsLoader,
  }
}
```

Remember that when we instantiate an Article we pass it the `laoders` object. 
So our article proxy has access to the `articleCommentIdsLoader` through its context, 
we just need to write the getter for `article.comments`.
Getters are defined when creating the proxy class:
```js
const Comment = createProxy({ entityType: 'Comment' })
const Article = createProxy({ 
  entityType: 'Article',
  getters: {
    async comments() {
      const ids = await this.context.loaders.articleCommentIdsLoader.load(this.id)
      return ids.map((id) => new Comment(id, this.context))
    }
  } 
})
```

And that is it, all endpoints are now working.

Here is a recap of the necessary code to make this work, note how much clearer it looks compared to the raw solution we had at the beggining:
```js
// When setting up the GraphQL context for every request
const articleLoader = new DataLoader(/*...*/)
const commentLoader = new DataLoader(/*...*/)
const articleCommentIdsLoader = new DataLoader(/*...*/)

const context = {
  loaders: {
    Article: articleLoader,
    Comment: commentLoader,
    articleCommentIdsLoader,
  }
}

// Declare your proxy classes only once
const Comment = createProxy({ entityType: 'Comment' })
const Article = createProxy({ 
  entityType: 'Article',
  getters: {
    async comments() {
      const ids = await this.context.loaders.articleCommentIdsLoader.load(this.id)
      return ids.map((id) => new Comment(id, this.context))
    }
  } 
})

// Write the only resolver you need
const resolvers = {
  Query: {
    article: (_, { id }, { loaders }) => new Article(id, { loaders })
  }
}
```

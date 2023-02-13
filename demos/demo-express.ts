import dotenv from 'dotenv-safe'
import express from 'express'
import { oraPromise } from 'ora'

import { ChatGPTAPI } from '../src'

dotenv.config()

/**
 * Demo CLI for testing basic functionality.
 *
 * ```
 * npx tsx demos/demo-express.ts
 * ```
 */
class requestData {
  public prompt: string = ''
}
class App {
  public express
  public api: any

  constructor() {
    this.express = express()
    this.express.use(express.json())
    this.express.use(express.urlencoded({ extended: true }))
    this.mountRoutes()
    this.initOpenAI()
  }

  private mountRoutes(): void {
    const router = express.Router()
    router.post('/openai', async (req: any, res: any) => {
      try {
        console.log(req.body.prompt)
        const result = await this.callOpenAI(
          req.body.prompt,
          req.body.messageId,
          req.body.conversationId
        )
        res.send(result)
      } catch (err: any) {
        console.log(err)
        res.send(err.statusCode + ' ' + err.statusText)
      }
    })
    this.express.use('/', router)
  }

  public async initOpenAI() {
    const clientOptions = {
      // (Optional) Parameters as described in https://platform.openai.com/docs/api-reference/completions
      modelOptions: {
        // The model is set to text-chat-davinci-002-20230126 by default, but you can override
        // it and any other parameters here
        model: 'text-davinci-002-render'
      },
      // (Optional) Set a custom prompt prefix. As per my testing it should work with two newlines
      // promptPrefix: 'You are not ChatGPT...\n\n',
      // (Optional) Set a custom name for the user
      // userLabel: 'User',
      // (Optional) Set a custom name for ChatGPT
      // chatGptLabel: 'ChatGPT',
      // (Optional) Set to true to enable `console.debug()` logging
      debug: false
    }
    const cacheOptions = {
      // Options for the Keyv cache, see https://www.npmjs.com/package/keyv
      // This is used for storing conversations, and supports additional drivers (conversations are stored in memory by default)
      // For example, to use a JSON file (`npm i keyv-file`) as a database:
      // store: new KeyvFile({ filename: 'cache.json' }),
    }
    this.api = new ChatGPTAPI({
      apiKey: process.env.OPENAI_API_KEY,
      clientOptions,
      cacheOptions
    })
  }

  public async callOpenAI(
    prompt: string,
    messageId: string,
    conversationId: string
  ): Promise<any> {
    console.log('mid:' + messageId)
    console.log('cid:' + conversationId)

    if (messageId == '' || conversationId == '') {
      const res = await oraPromise(this.api.sendMessage(prompt), {
        text: prompt
      })
      return res
    } else {
      const res = await oraPromise(
        this.api.sendMessage(prompt, {
          conversationId: conversationId,
          parentMessageId: messageId
        }),
        {
          text: prompt
        }
      )
      return res
    }
  }

  public async closeOpenAI() {
    // close the browser at the end
    await this.api.closeSession()
  }
}

const port = 31010

const app: express.Application = new App().express
app.listen(port, () => {
  console.log(`server is listening on ${port}`)
})

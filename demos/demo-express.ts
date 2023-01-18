import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'
import { ChatGPTAPIBrowser } from '../src'
import express from 'express'
import { appendFile } from 'fs'
import { stringify } from 'querystring'

dotenv.config()

/**
 * Demo CLI for testing basic functionality.
 *
 * ```
 * npx tsx demos/demo.ts
 * ```
 */
class requestData
{
  public prompt:string = ""
}
class App {
  public express
  public api : any

  constructor () {
    this.express = express() 
    this.express.use(express.json())
    this.express.use(express.urlencoded({ extended: true }))
    this.mountRoutes()
    this.initOpenAI();
  }

  private mountRoutes (): void {
    const router = express.Router()
    router.post('/openai',  async (req , res) => {     
      try{   
        console.log(req.body.prompt)
       const result = await this.callOpenAI(req.body.prompt)
       res.send(result)
      }
      catch(err)
      {
        console.log(err)
        res.send("Failed")
      }
    })
    this.express.use('/', router)
  }

public async initOpenAI() {
  const email = process.env.OPENAI_EMAIL
  const password = process.env.OPENAI_PASSWORD

  if (email!=undefined && password!=undefined)
  this.api = new ChatGPTAPIBrowser({
    email,
    password,
    debug: false,
    minimize: true
  })
  await this.api.initSession()  
}

public async  callOpenAI(prompt: string) : Promise<any>
{
  const prompt1 =
  'Write a python version of bubble sort. Do not include example usage.'

  const prompt2 =
  'How are you today.'

const res = await oraPromise(this.api.sendMessage(prompt), {
  text: prompt
})
return res;
}

public async closeOpenAI()
{  
  // close the browser at the end
  await this.api.closeSession();
}
}

const port = 31010

const app: express.Application = new App().express
app.listen(port, () => { 
   console.log(`server is listening on ${port}`)
})

import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'
import { ChatGPTAPI} from '../src'
import express from 'express'

dotenv.config()

/**
 * Demo CLI for testing basic functionality.
 *
 * ```
 * npx tsx demos/demo-express.ts
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
       const result = await this.callOpenAI(req.body.prompt,req.body.messageId,req.body.conversationId)
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
  this.api = new ChatGPTAPI({ apiKey: process.env.OPENAI_API_KEY })
}

public async  callOpenAI(prompt: string,messageId: string, conversationId: string) : Promise<any>
{

  console.log("mid:"+messageId)
  console.log("cid:"+conversationId)

if(messageId=="" || conversationId == "")
{
const res = await oraPromise(this.api.sendMessage(prompt), {
  text: prompt
})
return res;
}
else
{
  const res = await oraPromise(this.api.sendMessage(prompt,{
    conversationId: conversationId,
    parentMessageId: messageId
  }),{
    text: prompt
  })
  return res;

}
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
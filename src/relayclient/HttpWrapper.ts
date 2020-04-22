import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'

const LOGMAXLEN = 120

export default class HttpWrapper {
  private readonly provider: AxiosInstance
  private readonly logreq: boolean

  constructor (opts: AxiosRequestConfig = {}, logreq: boolean = false) {
    this.provider = axios.create(Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, opts))
    this.logreq = logreq

    if (this.logreq) {
      this.provider.interceptors.response.use(function (response) {
        console.log('got response:', response.config.url, JSON.stringify(response.data).slice(0, LOGMAXLEN))
        return response
      }, async function (error: any): Promise<never> {
        const errData = error.response != null ? error.response.data : { error: error.message }
        const errStr = ((typeof errData === 'string') ? errData : JSON.stringify(errData)).slice(0, LOGMAXLEN)
        const errUrl = error.response != null ? error.response.config.url : error.address
        console.log('got response:', errUrl, 'err=', errStr)
        return Promise.reject(error)
      })
    }
  }

  async sendPromise (url: string, jsonRequestData: any): Promise<any> {
    if (this.logreq) {
      console.log('sending request:', url, JSON.stringify(jsonRequestData ?? {}).slice(0, LOGMAXLEN))
    }

    const response = await this.provider.post(url, jsonRequestData)
    return response.data
  }
}

module.exports = HttpWrapper

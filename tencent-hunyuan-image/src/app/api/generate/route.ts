import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, getPluginSettingsFromRequest, PluginErrorType } from "@lobehub/chat-plugin-sdk";
import { 
  Settings, 
  IHunyuanImageGenerationRequest, 
  IHunyuanImageGenerationResponse, 
  IHunyuanImageQueryResponse,
  JobStatusCode
} from "@/type";
import axios from "axios";
import * as CryptoJS from "crypto-js";

const HOST = "hunyuan.tencentcloudapi.com";
const SERVICE = "hunyuan";
const REGION = "ap-guangzhou";
const VERSION = "2023-09-01";

// 使用CryptoJS实现TC3-HMAC-SHA256签名
function sign(secretKey: string, date: string, service: string, str: string): string {
  const hmacDate = CryptoJS.HmacSHA256(date, "TC3" + secretKey);
  const hmacService = CryptoJS.HmacSHA256(service, hmacDate);
  const hmacSigning = CryptoJS.HmacSHA256("tc3_request", hmacService);
  return CryptoJS.HmacSHA256(str, hmacSigning).toString(CryptoJS.enc.Hex);
}

// 生成腾讯云API请求所需的签名和头信息
function generateTencentCloudHeaders(secretId: string, secretKey: string, action: string, payload: string) {
  // 获取当前UTC时间戳和日期字符串
  const timestamp = Math.floor(Date.now() / 1000);
  const dateObj = new Date(timestamp * 1000);
  const dateStr = dateObj.toISOString().split('T')[0];
  
  // 计算请求体的哈希值
  const hashedRequestPayload = CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);
  
  // 构建规范请求串
  const canonicalRequest = [
    "POST",
    "/",
    "",
    "content-type:application/json; charset=utf-8",
    "host:" + HOST,
    "",
    "content-type;host",
    hashedRequestPayload
  ].join("\n");
  
  // 构建待签名字符串
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = dateStr + "/" + SERVICE + "/" + "tc3_request";
  const hashedCanonicalRequest = CryptoJS.SHA256(canonicalRequest).toString(CryptoJS.enc.Hex);
  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    hashedCanonicalRequest
  ].join("\n");
  
  // 计算签名
  const signature = sign(secretKey, dateStr, SERVICE, stringToSign);
  
  // 构建授权字符串
  const authorization = algorithm +
    " Credential=" + secretId + "/" + credentialScope +
    ", SignedHeaders=content-type;host" +
    ", Signature=" + signature;
  
  // 返回请求头
  return {
    Authorization: authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: HOST,
    "X-TC-Action": action,
    "X-TC-Timestamp": timestamp.toString(),
    "X-TC-Version": VERSION,
    "X-TC-Region": REGION
  };
}

export async function POST(req: NextRequest) {
  try {
    // 获取插件设置
    const settings = getPluginSettingsFromRequest<Settings>(req);
    if (!settings) {
      return createErrorResponse(PluginErrorType.PluginSettingsInvalid, {
        message: 'Plugin settings not found.',
      });
    }

    const secretId = settings.TENCENT_SECRET_ID;
    const secretKey = settings.TENCENT_SECRET_KEY;

    if (!secretId || !secretKey) {
      return createErrorResponse(PluginErrorType.PluginSettingsInvalid, {
        message: 'Tencent Cloud credentials are required.',
      });
    }

    // 解析请求体
    const body = await req.json();
    const { Prompt, NegativePrompt, Style, Resolution, Num, Clarity, ContentImage, Revise, Seed } = body;

    // 构建请求参数
    const requestParams: IHunyuanImageGenerationRequest = {
      Prompt,
      NegativePrompt,
      Style,
      Resolution: Resolution || "1024:1024",
      Num: Num || 1,
      Clarity,
      ContentImage,
      Revise: Revise !== undefined ? Revise : 1,
      Seed
    };

    // 提交图像生成任务
    const submitPayload = JSON.stringify(requestParams);
    const submitHeaders = generateTencentCloudHeaders(secretId, secretKey, "SubmitHunyuanImageJob", submitPayload);

    console.log("Submitting job with payload:", submitPayload);
    console.log("Headers:", JSON.stringify(submitHeaders));
    
    const submitResponse = await axios.post(
      `https://${HOST}`,
      submitPayload,
      { headers: submitHeaders }
    );

    console.log("Submit response:", JSON.stringify(submitResponse.data));

    if (submitResponse.status !== 200 || submitResponse.data.Response?.Error) {
      const errorMsg = submitResponse.data.Response?.Error?.Message || 'Unknown error';
      console.error(`Failed to submit image generation job: ${errorMsg}`);
      return NextResponse.json({
        message: `API Error: ${errorMsg}`
      }, { status: 400 });
    }

    const submitData: IHunyuanImageGenerationResponse = submitResponse.data;
    
    // 检查JobId是否存在
    if (!submitData.Response || !submitData.Response.JobId) {
      console.error('No JobId returned from API:', submitData);
      return NextResponse.json({
        message: 'Failed to get job ID from API response.'
      }, { status: 500 });
    }
    
    const jobId = submitData.Response.JobId;
    console.log("Job ID:", jobId);

    // 轮询查询任务状态
    let queryData: IHunyuanImageQueryResponse;
    let retryCount = 0;
    const maxRetries = 60; // 最多等待30秒 (60次 * 500ms)

    do {
      // 构建查询请求
      const queryPayload = JSON.stringify({ JobId: jobId });
      const queryHeaders = generateTencentCloudHeaders(secretId, secretKey, "QueryHunyuanImageJob", queryPayload);

      console.log("Querying job status, attempt:", retryCount + 1);
      
      const queryResponse = await axios.post(
        `https://${HOST}`,
        queryPayload,
        { headers: queryHeaders }
      );

      console.log("Query response:", JSON.stringify(queryResponse.data));
      
      if (queryResponse.data.Response?.Error) {
        const errorMsg = queryResponse.data.Response.Error.Message || 'Unknown error';
        console.error(`Query failed: ${errorMsg}`);
        return NextResponse.json({
          message: `API Error during query: ${errorMsg}`
        }, { status: 400 });
      }
      
      queryData = queryResponse.data;
      
      // 检查Response对象是否存在
      if (!queryData.Response) {
        console.error('Invalid query response:', queryData);
        return NextResponse.json({
          message: 'Invalid response from API.'
        }, { status: 500 });
      }
      
      // 如果任务失败，返回错误信息
      if (queryData.Response.JobStatusCode === JobStatusCode.FAILED) {
        console.error('Image generation failed:', queryData.Response.JobErrorMsg);
        return NextResponse.json({
          message: `Image generation failed: ${queryData.Response.JobErrorMsg || 'Unknown error'}`
        }, { status: 400 });
      }

      // 如果任务仍在处理中，等待500ms后再次查询
      if (queryData.Response.JobStatusCode === JobStatusCode.WAITING || 
          queryData.Response.JobStatusCode === JobStatusCode.RUNNING) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        retryCount++;
      }
    } while (
      (queryData.Response.JobStatusCode === JobStatusCode.WAITING || 
       queryData.Response.JobStatusCode === JobStatusCode.RUNNING) && 
      retryCount < maxRetries
    );

    // 如果超过最大重试次数仍未完成，返回超时错误
    if (retryCount >= maxRetries) {
      return NextResponse.json({
        message: 'Image generation timed out.'
      }, { status: 408 });
    }

    // 获取生成的图片URL
    const imageUrls = queryData.Response.ResultImage || [];
    
    // 检查是否有图片URL
    if (!imageUrls.length) {
      console.error('No image URLs returned:', queryData);
      return NextResponse.json({
        message: 'No images were generated.'
      }, { status: 500 });
    }
    
    const revisedPrompt = queryData.Response.RevisedPrompt?.[0] || Prompt;

    // 构建Markdown格式的响应
    const markdownResponse = `
      ![Generated Image](${imageUrls[0]})
      *提示词: ${Prompt}*
      ${revisedPrompt !== Prompt ? `*扩写后的提示词: ${revisedPrompt}*` : ''}
      ${NegativePrompt ? `*反向提示词: ${NegativePrompt}*` : ''}
      ${Style ? `*风格: ${Style}*` : ''}
      *分辨率: ${requestParams.Resolution}*
    `.trim();

    // 返回生成的图片URL
    return NextResponse.json({ markdownResponse });
  } catch (error: any) {
    console.error('Error generating image:', error);
    // 提供更详细的错误信息
    const errorMessage = error.response 
      ? `API Error: ${JSON.stringify(error.response.data)}` 
      : error.message || 'Unknown error';
      
    return NextResponse.json({
      message: `Failed to generate image: ${errorMessage}`
    }, { status: 500 });
  }
}

/**
 * @description: This file contains all the typescript interfaces used in the application, for Tencent Hunyuan Image Generation.
 */

// Submit Image Generation Job Request
export interface IHunyuanImageGenerationRequest {
  Prompt: string;
  NegativePrompt?: string;
  Style?: string;
  Resolution?: string;
  Num?: number;
  Clarity?: string;
  ContentImage?: {
    ImageUrl: string;
  };
  Revise?: number;
  Seed?: number;
}

// Submit Image Generation Job Response
export interface IHunyuanImageGenerationResponse {
  Response: {
    JobId: string;
    RequestId: string;
  };
}

// Query Image Generation Job Request
export interface IHunyuanImageQueryRequest {
  JobId: string;
}

// Query Image Generation Job Response
export interface IHunyuanImageQueryResponse {
  Response: {
    JobStatusCode: string;
    JobStatusMsg: string;
    JobErrorCode?: string;
    JobErrorMsg?: string;
    ResultImage: string[];
    ResultDetails: string[];
    RevisedPrompt?: string[];
    RequestId: string;
  };
}

// Job Status Enum
export enum JobStatusCode {
  WAITING = "1",
  RUNNING = "2",
  FAILED = "4",
  COMPLETED = "5"
}

// Settings Interface
export interface Settings {
  TENCENT_SECRET_ID: string;
  TENCENT_SECRET_KEY: string;
}

// Helper interface for plugin implementation
export interface IHunyuanImageResult {
  status: 'success' | 'error' | 'processing';
  imageUrls?: string[];
  error?: string;
  revisedPrompt?: string;
}

// Common API parameters
export interface ITencentCommonParams {
  Action: string;
  Version: string;
  Region: string;
}

// Submit Job Common Parameters
export interface ISubmitJobParams extends ITencentCommonParams {
  Action: 'SubmitHunyuanImageJob';
  Version: '2023-09-01';
  Region: 'ap-guangzhou';
}

// Query Job Common Parameters
export interface IQueryJobParams extends ITencentCommonParams {
  Action: 'QueryHunyuanImageJob';
  Version: '2023-09-01';
  Region: 'ap-guangzhou';
}
import { ChatInputNode } from "./ChatInputNode";
import { ChatOutputNode } from "./ChatOutputNode";
import { UrlNode } from "./UrlNode";
import { CalculatorNode } from "./CalculatorNode";
import { AgentNode } from "./AgentNode";
import { VideoStudioNode } from "./VideoStudioNode";

export const nodeTypes = {
  chatInput: ChatInputNode,
  chatOutput: ChatOutputNode,
  url: UrlNode,
  calculator: CalculatorNode,
  agent: AgentNode,
  videoUpload: VideoStudioNode,
  imageUpload: VideoStudioNode,
  doubaoAnalysis: VideoStudioNode,
  storyboardScript: VideoStudioNode,
  characterAsset: VideoStudioNode,
  sceneAsset: VideoStudioNode,
  propAsset: VideoStudioNode,
  videoGeneration: VideoStudioNode,
  videoStitcher: VideoStudioNode,
  timeline: VideoStudioNode,
};

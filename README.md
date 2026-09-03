# NodeList_LLM

## Google Vertex AI 图片与视频生成

画布的图片生成节点支持 `gemini-2.5-flash-image`，视频生成节点支持
`veo-3.1-fast-generate-001`。两者都通过后端调用 Vertex AI，服务账号内容不会发送到浏览器。

本地开发在 `backend/.env` 配置：

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
VERTEX_AI_PROJECT=your-google-cloud-project
VERTEX_IMAGE_MODEL=gemini-2.5-flash-image
VERTEX_IMAGE_LOCATION=global
VERTEX_VIDEO_MODEL=veo-3.1-fast-generate-001
VERTEX_VIDEO_LOCATION=us-central1
```

Veo 默认直接在异步操作响应中返回视频。生产环境建议额外配置
`VERTEX_VIDEO_GCS_URI=gs://your-bucket/prefix/`，并授予服务账号写入该存储桶的权限。
如果后端运行在 Docker 中，请把凭据文件只读挂载到容器，并将
`GOOGLE_APPLICATION_CREDENTIALS` 设置为容器内路径；不要把 JSON 密钥复制进镜像或提交到仓库。

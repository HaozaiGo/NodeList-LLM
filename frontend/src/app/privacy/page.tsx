import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";


export const metadata: Metadata = {
  title: "隐私政策 | enepath.ai",
  description: "enepath.ai 隐私政策",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="隐私政策"
      description="本政策说明 enepath.ai 在提供 AI 图片与视频创作服务时如何收集、使用和保护信息。"
    >
      <section>
        <h2>1. 我们收集的信息</h2>
        <p>
          当你注册或登录时，我们会处理邮箱地址、账号标识和必要的登录状态。使用 Google 登录时，我们只接收完成身份验证所需的基础账号信息，包括 Google 账号标识和邮箱地址；我们不会读取 Gmail、Google Drive 或通讯录内容。
        </p>
        <p>
          使用创作功能时，我们会处理你主动上传的图片、视频、提示词、画布项目、生成结果及任务状态。我们还可能记录必要的设备、网络和服务日志，用于安全防护、故障排查和服务改进。
        </p>
      </section>

      <section>
        <h2>2. 信息的使用方式</h2>
        <p>
          我们使用这些信息来创建和维护账号、保存项目与资产、调用你选择的生成模型、展示任务结果、计算服务用量，以及识别滥用、保障账号与平台安全。
        </p>
      </section>

      <section>
        <h2>3. 第三方服务与信息共享</h2>
        <p>
          为完成你发起的生成任务，相关素材和提示词可能会被发送给所选模型或基础设施服务商。我们仅在提供服务、遵守法律或保护平台与用户权益所必需的范围内共享信息，不出售个人信息。
        </p>
      </section>

      <section>
        <h2>4. 信息保存与安全</h2>
        <p>
          我们会在提供服务、履行安全与合规义务所需的期限内保存信息，并采取访问控制、传输保护和运行监控等合理措施。互联网服务无法保证绝对安全，请妥善保管账号凭据。
        </p>
      </section>

      <section>
        <h2>5. 你的选择与权利</h2>
        <p>
          你可以在产品中管理项目和资产，也可以联系我们查询、更正或申请删除账号相关信息。删除请求可能受法律留存、安全审计或争议处理要求限制。
        </p>
      </section>

      <section>
        <h2>6. 未成年人</h2>
        <p>本服务不面向未满适用法律规定年龄、且无法自行同意数据处理的未成年人。</p>
      </section>

      <section>
        <h2>7. 政策更新与联系</h2>
        <p>
          我们可能随服务变化更新本政策，并在本页面标注更新日期。如对隐私或数据处理有疑问，请联系
          <a href="mailto:bb83100436@gmail.com"> bb83100436@gmail.com</a>。
        </p>
      </section>
    </LegalPage>
  );
}

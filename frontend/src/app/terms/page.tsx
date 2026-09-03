import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";


export const metadata: Metadata = {
  title: "服务条款 | enepath.ai",
  description: "enepath.ai 服务条款",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="服务条款"
      description="使用 enepath.ai 即表示你同意遵守以下服务规则。"
    >
      <section>
        <h2>1. 账号与服务使用</h2>
        <p>
          你应提供准确的注册信息、妥善保护账号，并对账号下的活动负责。不得未经授权访问其他账号、干扰平台运行，或绕过用量、权限和安全限制。
        </p>
      </section>

      <section>
        <h2>2. 用户内容</h2>
        <p>
          你保留对上传素材、提示词和项目内容依法享有的权利，并保证有权提交和处理这些内容。为提供生成、存储和展示服务，你授权我们及必要的服务商在服务范围内处理这些内容。
        </p>
      </section>

      <section>
        <h2>3. AI 生成内容</h2>
        <p>
          AI 结果可能不准确、不完整或与他人结果相似。你应在发布或商业使用前自行审核事实、版权、肖像、商标和其他合规风险，并对最终使用方式负责。
        </p>
      </section>

      <section>
        <h2>4. 禁止行为</h2>
        <p>
          不得利用本服务生成或传播违法、欺诈、侵权、恶意骚扰、危害他人安全的内容，也不得上传无权使用的个人数据或受保护素材。
        </p>
      </section>

      <section>
        <h2>5. 积分与计费</h2>
        <p>
          部分模型调用会按页面展示的规则扣除积分。由于模型任务已经产生计算成本，已完成或已提交且不可撤销的调用通常不予退还；因平台故障导致的异常扣费会按核查结果处理。
        </p>
      </section>

      <section>
        <h2>6. 服务变更与终止</h2>
        <p>
          我们可能为维护、安全、模型供应变化或产品升级而调整服务。若账号违反本条款、造成安全风险或法律要求限制使用，我们可以暂停或终止相关访问。
        </p>
      </section>

      <section>
        <h2>7. 责任边界</h2>
        <p>
          服务按现状提供。在法律允许的范围内，我们不对第三方模型、外部网络或用户自行发布和使用生成内容所造成的间接损失承担责任。
        </p>
      </section>

      <section>
        <h2>8. 更新与联系</h2>
        <p>
          我们可能更新本条款，并在本页面标注更新日期。如有问题，请联系
          <a href="mailto:bb83100436@gmail.com"> bb83100436@gmail.com</a>。
        </p>
      </section>
    </LegalPage>
  );
}

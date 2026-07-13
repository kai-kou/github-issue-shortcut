import type { LegalBlock } from "../i18n/translations";

interface LegalPageData {
  title: string;
  intro: string;
  sections: { heading: string; blocks: LegalBlock[] }[];
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if ("ul" in block) {
    return (
      <ul>
        {block.ul.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p>{block.p}</p>;
}

function LegalPage({ title, intro, sections }: LegalPageData) {
  return (
    <article>
      <h1>{title}</h1>
      <p>{intro}</p>
      {sections.map((section) => (
        <div key={section.heading}>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, i) => (
            <LegalBlockView key={i} block={block} />
          ))}
        </div>
      ))}
    </article>
  );
}

export default LegalPage;

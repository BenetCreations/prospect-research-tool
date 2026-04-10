export default function ResearchBrief({ text, variant = 'panel' }) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const isPage = variant === 'page';

  return (
    <article
      className={
        isPage
          ? 'max-w-3xl text-[15px] text-slate-300 leading-[1.7] space-y-1'
          : 'text-sm text-slate-300 space-y-1.5 border border-slate-700/80 rounded-lg p-3 bg-slate-800/60'
      }
    
    >
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h3
              key={i}
              className={
                isPage
                  ? 'font-semibold text-lg text-slate-100 pt-6 pb-2 first:pt-0 border-b border-slate-800'
                  : 'font-semibold text-slate-100 pt-3 first:pt-0'
              }
            >
              {line.slice(3)}
            </h3>
          );
        }
        return line.trim() ? (
          <p key={i} className="leading-relaxed text-slate-400">
            {line}
          </p>
        ) : (
          <div key={i} className={isPage ? 'h-2' : ''} />
        );
      })}
    </article>
  );
}

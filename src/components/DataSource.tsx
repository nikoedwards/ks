export default function DataSource({ note }: { note?: string }) {
  return (
    <p className="text-xs text-gray-400 text-right pt-1">
      数据来源:{' '}
      <a
        href="https://webrobots.io/kickstarter-datasets/"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-gray-600 underline underline-offset-2"
      >
        webrobots.io Kickstarter Datasets
      </a>
      {note && <span className="text-gray-300 mx-1">·</span>}
      {note && <span>{note}</span>}
    </p>
  );
}

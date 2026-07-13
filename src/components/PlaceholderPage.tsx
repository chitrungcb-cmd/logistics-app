export default function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
      <div className="mt-6 flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-sm text-gray-400">
        Module đang được xây dựng
      </div>
    </div>
  );
}

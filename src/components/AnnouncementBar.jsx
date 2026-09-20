import { useApp } from '../context/AppContext';

export default function AnnouncementBar() {
  const { content } = useApp();
  const announcement = content.announcement;
  if (!announcement?.enabled || !announcement?.message) return null;
  return (
    <div className="bg-fg text-bg text-center py-2 px-4">
      <p className="text-[11px] font-mono tracking-widest uppercase">{announcement.message}</p>
    </div>
  );
}

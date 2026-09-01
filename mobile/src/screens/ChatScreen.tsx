import { useEffect, useRef, useState } from 'react';
import { useChat } from '@/store/chat';
import { Avatar, Spinner } from '@/components';
import type { Channel } from '@/types/db';

interface Props {
  channel: Channel;
  onBack: () => void;
}

export function ChatScreen({ channel, onBack }: Props) {
  const { messages, profiles, loading, selectChannel, sendMessage } = useChat();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void selectChannel(channel.id);
  }, [channel.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!text.trim()) return;
    const t = text;
    setText('');
    await sendMessage(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="screen screen--chat">
      <header className="screen-header screen-header--back">
        <button className="back-btn" onClick={onBack}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h2># {channel.name}</h2>
      </header>

      <div className="messages-list">
        {loading && <Spinner />}
        {!loading && messages.length === 0 && (
          <p className="empty-state">Aucun message. Soyez le premier !</p>
        )}
        {messages.map((msg, i) => {
          const author = profiles[msg.author_id];
          const prev = messages[i - 1];
          const grouped = prev?.author_id === msg.author_id &&
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;

          return (
            <div key={msg.id} className={`message ${grouped ? 'message--grouped' : ''}`}>
              {!grouped && (
                <Avatar
                  url={author?.avatar_url ?? null}
                  name={author?.display_name ?? author?.username ?? '?'}
                  size={36}
                  accent={author?.accent}
                />
              )}
              {grouped && <div className="message-avatar-gap" />}
              <div className="message-body">
                {!grouped && (
                  <div className="message-header">
                    <span className="message-author">{author?.display_name ?? author?.username ?? 'Utilisateur'}</span>
                    <span className="message-time">
                      {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
                <p className="message-content">{msg.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="message-input-bar">
        <textarea
          className="message-input"
          placeholder={`Message #${channel.name}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
          aria-label="Envoyer"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

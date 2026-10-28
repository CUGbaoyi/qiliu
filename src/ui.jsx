import { useEffect, useRef, useState } from 'react';
import { XIcon, RssIcon, FilmSlateIcon } from '@phosphor-icons/react';
import { bytes } from './data';

export function Icon({ as: C, size = 22, ...props }) {
  return <C size={size} weight="light" aria-hidden="true" {...props} />;
}
export function Amount({ value }) {
  const [n, u] = bytes(value);
  return (
    <>
      {n}
      <small>{u}</small>
    </>
  );
}
export function Modal({ children, title, onClose, wide = false }) {
  const ref = useRef(null),
    backdropPress = useRef(false);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  const outside = (e) => {
    const r = ref.current.getBoundingClientRect();
    return (
      e.target === ref.current &&
      (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    );
  };
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onPointerDown={(e) => {
        backdropPress.current = e.button === 0 && outside(e);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(e) => {
        const dismiss = backdropPress.current && outside(e);
        backdropPress.current = false;
        if (dismiss) onClose();
      }}
      aria-label={title}>
      <div className="modal-title">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <Icon as={XIcon} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Art({ item, large = false }) {
  const [failed, setFailed] = useState(false);
  return item.image && !failed ? (
    <img
      className={large ? 'detail-art' : 'resource-art'}
      src={item.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className={`${large ? 'detail-art' : 'resource-art'} art-fallback`}>
      <Icon as={item.feedId ? RssIcon : FilmSlateIcon} size={large ? 46 : 25} />
    </span>
  );
}

import { useEffect } from 'react'

interface Props {
  images: (string | null)[]
  activeIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}

export default function ImageLightbox({ images, activeIndex, onClose, onNavigate }: Props): React.JSX.Element {
  const total = images.length

  const prev = (): void => onNavigate((activeIndex - 1 + total) % total)
  const next = (): void => onNavigate((activeIndex + 1) % total)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const handleWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    if (e.deltaY > 0 || e.deltaX > 0) next()
    else prev()
  }

  const currentImg = images[activeIndex]

  return (
    <div className="lightbox-overlay" onClick={onClose} onWheel={handleWheel}>
      <button className="lightbox-close" onClick={onClose} title="關閉 (Esc)">✕</button>

      {total > 1 && (
        <>
          <button
            className="lightbox-nav lightbox-prev"
            onClick={(e) => { e.stopPropagation(); prev() }}
          >
            ‹
          </button>
          <button
            className="lightbox-nav lightbox-next"
            onClick={(e) => { e.stopPropagation(); next() }}
          >
            ›
          </button>
        </>
      )}

      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {currentImg
          ? <img src={currentImg} alt={`image ${activeIndex + 1}`} />
          : <div className="lightbox-loading">載入中...</div>
        }
        {total > 1 && (
          <div className="lightbox-counter">{activeIndex + 1} / {total}</div>
        )}
      </div>
    </div>
  )
}

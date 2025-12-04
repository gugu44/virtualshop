import { DragEvent } from 'react';
import { Garment } from '../types';

interface GarmentCardProps {
  garment: Garment;
}

const GarmentCard = ({ garment }: GarmentCardProps) => {
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        kind: 'garment',
        garmentId: garment.id,
      })
    );
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="garment-card" draggable onDragStart={onDragStart}>
      <div
        className="garment-card__swatch"
        aria-hidden
        style={{
          background: `linear-gradient(135deg, ${garment.color}, ${garment.accent})`,
        }}
      />
      <div className="garment-card__body">
        <p className="garment-card__category">{garment.category.toUpperCase()}</p>
        <p className="garment-card__name">{garment.name}</p>
        <p className="garment-card__desc">{garment.description}</p>
      </div>
    </div>
  );
};

export default GarmentCard;

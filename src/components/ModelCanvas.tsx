import { DragEvent, RefObject, useMemo, useRef } from 'react';
import { garments } from '../data/garments';
import { Garment, Placement } from '../types';

interface ModelCanvasProps {
  placements: Placement[];
  onDropGarment: (garment: Garment, x: number, y: number) => void;
  onMovePlacement: (placementId: string, x: number, y: number) => void;
}

const PLACEMENT_SIZE = 96;

const ModelCanvas = ({ placements, onDropGarment, onMovePlacement }: ModelCanvasProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const placementLookup = useMemo(
    () => Object.fromEntries(garments.map((item) => [item.id, item])),
    []
  );

  const getCoordinates = (event: DragEvent<HTMLDivElement>, offsetX = 0, offsetY = 0) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = event.clientX - rect.left - offsetX;
    const y = event.clientY - rect.top - offsetY;
    return { x, y };
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/json');
    if (!payload) return;

    try {
      const data = JSON.parse(payload) as
        | { kind: 'garment'; garmentId: string }
        | { kind: 'placement'; placementId: string; offsetX: number; offsetY: number };

      if (data.kind === 'garment') {
        const garment = placementLookup[data.garmentId];
        if (!garment) return;
        const { x, y } = getCoordinates(event, PLACEMENT_SIZE / 2, PLACEMENT_SIZE / 2);
        onDropGarment(garment, x, y);
      }

      if (data.kind === 'placement') {
        const { x, y } = getCoordinates(event, data.offsetX, data.offsetY);
        onMovePlacement(data.placementId, x, y);
      }
    } catch (error) {
      console.error('잘못된 드롭 데이터', error);
    }
  };

  return (
    <div
      ref={containerRef}
      className="model-canvas"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="model-canvas__backdrop">
        <div className="model-canvas__figure" aria-hidden />
      </div>
      {placements.map((placement) => (
        <PlacedGarment key={placement.id} placement={placement} containerRef={containerRef} />
      ))}
      {placements.length === 0 && (
        <p className="model-canvas__empty">패널에서 아이템을 끌어 배치해보세요.</p>
      )}
    </div>
  );
};

interface PlacedGarmentProps {
  placement: Placement;
  containerRef: RefObject<HTMLDivElement>;
}

const PlacedGarment = ({ placement, containerRef }: PlacedGarmentProps) => {
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const payload = {
      kind: 'placement' as const,
      placementId: placement.id,
      offsetX,
      offsetY,
    };

    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';

    if (containerRect) {
      const preview = document.createElement('div');
      preview.style.width = `${PLACEMENT_SIZE}px`;
      preview.style.height = `${PLACEMENT_SIZE}px`;
      preview.style.background = 'transparent';
      event.dataTransfer.setDragImage(preview, offsetX, offsetY);
    }
  };

  return (
    <div
      className="placed-garment"
      draggable
      onDragStart={onDragStart}
      style={{
        width: PLACEMENT_SIZE,
        height: PLACEMENT_SIZE,
        left: placement.x,
        top: placement.y,
        background: `linear-gradient(135deg, ${placement.garment.color}, ${placement.garment.accent})`,
      }}
    >
      <p className="placed-garment__label">{placement.garment.name}</p>
    </div>
  );
};

export default ModelCanvas;

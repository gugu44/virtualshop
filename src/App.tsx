import { useMemo, useState } from 'react';
import { garments } from './data/garments';
import { Garment, Placement } from './types';
import ModelCanvas from './components/ModelCanvas';
import GarmentCard from './components/GarmentCard';
import './styles/App.css';

const categories: { key: Garment['category'] | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'top', label: '상의' },
  { key: 'bottom', label: '하의' },
  { key: 'outer', label: '아우터' },
  { key: 'accessory', label: 'ACC' },
];

function App() {
  const [selectedCategory, setSelectedCategory] = useState<Garment['category'] | 'all'>('all');
  const [placements, setPlacements] = useState<Placement[]>([]);

  const filteredGarments = useMemo(
    () =>
      selectedCategory === 'all'
        ? garments
        : garments.filter((item) => item.category === selectedCategory),
    [selectedCategory]
  );

  const handleDrop = (garment: Garment, x: number, y: number) => {
    setPlacements((prev) => {
      const placement: Placement = {
        id: `${garment.id}-${Date.now()}`,
        garment,
        x,
        y,
      };
      return [...prev, placement];
    });
  };

  const handleMove = (placementId: string, x: number, y: number) => {
    setPlacements((prev) =>
      prev.map((item) => (item.id === placementId ? { ...item, x, y } : item))
    );
  };

  const handleReset = () => setPlacements([]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <p className="app__eyebrow">프로토타입</p>
          <h1>가상 피팅 스튜디오</h1>
          <p className="app__subtitle">
            쇼핑몰의 상의·하의·아우터를 드래그 앤 드롭으로 모델 이미지 위에 배치해
            미리 코디를 구성합니다.
          </p>
        </div>
        <button className="ghost-button" onClick={handleReset} type="button">
          리셋
        </button>
      </header>

      <main className="app__layout">
        <section className="panel">
          <div className="panel__header">
            <h2>아이템</h2>
            <div className="chip-row">
              {categories.map((category) => (
                <button
                  key={category.key}
                  className={
                    category.key === selectedCategory ? 'chip chip--active' : 'chip'
                  }
                  onClick={() => setSelectedCategory(category.key)}
                  type="button"
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
          <div className="garment-grid">
            {filteredGarments.map((garment) => (
              <GarmentCard key={garment.id} garment={garment} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>착장 스튜디오</h2>
            <p className="panel__hint">아이템을 끌어 모델 영역에 올려보세요.</p>
          </div>
          <ModelCanvas
            placements={placements}
            onDropGarment={handleDrop}
            onMovePlacement={handleMove}
          />
        </section>
      </main>
    </div>
  );
}

export default App;

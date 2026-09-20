function Marker({ label, x, y }) {
  return (
    <g>
      <circle cx={x} cy={y} r="13" className="garment-marker-circle" />
      <text x={x} y={y + 4} textAnchor="middle" className="garment-marker-text">
        {label}
      </text>
    </g>
  );
}

function ArrowHead({ points }) {
  return <polygon points={points} className="garment-arrow-head" />;
}

function TShirtArtwork() {
  return (
    <svg viewBox="0 0 320 340" role="img" aria-label="T-shirt measurement illustration">
      <g className="garment-shape">
        <path d="M112 50C125 61 141 67 160 67C179 67 195 61 208 50L247 69L294 120L258 158L222 126L222 292L98 292L98 126L62 158L26 120L73 69Z" />
        <path d="M124 52C129 79 191 79 196 52" />
        <path d="M98 126L112 83M222 126L208 83" />
      </g>

      <g className="garment-measure-line">
        <line x1="98" y1="154" x2="222" y2="154" />
        <ArrowHead points="98,154 109,148 109,160" />
        <ArrowHead points="222,154 211,148 211,160" />
      </g>
      <g className="garment-measure-line">
        <line x1="190" y1="72" x2="190" y2="292" />
        <ArrowHead points="190,72 184,83 196,83" />
        <ArrowHead points="190,292 184,281 196,281" />
      </g>
      <g className="garment-measure-line">
        <line x1="210" y1="70" x2="271" y2="134" />
        <ArrowHead points="210,70 213,82 221,74" />
        <ArrowHead points="271,134 259,131 267,123" />
      </g>

      <Marker label="A" x="160" y="154" />
      <Marker label="B" x="190" y="215" />
      <Marker label="C" x="247" y="108" />
    </svg>
  );
}

function HoodieArtwork() {
  return (
    <img
      src="/images/size-guide/hoodie-measurement.png"
      alt="Hoodie flat measurement guide"
      className="up-garment-generated-image"
    />
  );
}

function SweatshirtArtwork() {
  return (
    <svg viewBox="0 0 320 360" role="img" aria-label="Sweatshirt measurement illustration">
      <g className="garment-shape">
        <path d="M118 49C127 63 142 70 160 70C178 70 193 63 202 49L238 68L290 180L250 202L220 147L222 314L98 314L100 147L70 202L30 180L82 68Z" />
        <path d="M126 51C132 76 188 76 194 51" />
        <line x1="98" y1="314" x2="222" y2="314" />
      </g>
      <g className="garment-measure-line">
        <line x1="100" y1="160" x2="220" y2="160" />
        <ArrowHead points="100,160 111,154 111,166" />
        <ArrowHead points="220,160 209,154 209,166" />
      </g>
      <g className="garment-measure-line">
        <line x1="190" y1="74" x2="190" y2="314" />
        <ArrowHead points="190,74 184,85 196,85" />
        <ArrowHead points="190,314 184,303 196,303" />
      </g>
      <g className="garment-measure-line">
        <path d="M205 61C237 91 258 134 270 191" />
        <ArrowHead points="205,61 208,73 217,65" />
        <ArrowHead points="270,191 260,182 272,179" />
      </g>
      <Marker label="A" x="160" y="160" />
      <Marker label="B" x="190" y="226" />
      <Marker label="C" x="251" y="126" />
    </svg>
  );
}

function LongSleeveArtwork() {
  return <SweatshirtArtwork />;
}

export default function GarmentArtwork({ garmentType = 'tshirt' }) {
  const artworkByType = {
    tshirt: {
      component: <TShirtArtwork />,
      caption: 'Oversized T-shirt · flat measurement',
    },
    hoodie: {
      component: <HoodieArtwork />,
      caption: 'Oversized hoodie · flat measurement',
    },
    sweatshirt: {
      component: <SweatshirtArtwork />,
      caption: 'Oversized sweatshirt · flat measurement',
    },
    longsleeve: {
      component: <LongSleeveArtwork />,
      caption: 'Long sleeve top · flat measurement',
    },
  };

  const selectedArtwork = artworkByType[garmentType] || artworkByType.tshirt;

  return (
    <div className="up-garment-art">
      {selectedArtwork.component}
      <span className="up-garment-caption">{selectedArtwork.caption}</span>
    </div>
  );
}

// Quote request questions per category (docs/SMART-SOURCING-SPEC.md). Each answer becomes a requirement line
// that every business answers against (Meets / Partly / Can't), so quotes compare like for like.
// Field: { id, q, hint, type: 'text' | 'number' | 'date' | 'choice', options?, must? }. "Not sure" choices let
// buyers who don't know the details still ask. Categories without their own template use GENERIC.
const NOT_SURE = 'Not sure, please advise';

const GENERIC = [
  { id: 'qty', q: 'How many, or how big is the job?', hint: 'e.g. 50 pieces, a 3-bedroom house, 2 days of work', type: 'text', must: true },
  { id: 'spec', q: 'Any size, model, brand or standard you need?', hint: 'Leave blank if not sure', type: 'text' },
  { id: 'date', q: 'When do you need it delivered or done?', type: 'date', must: true },
  { id: 'budget', q: 'Budget range (optional)', hint: 'e.g. KSh 50,000 to 80,000. Helps businesses quote the right option', type: 'text' },
];

export const REQUEST_TEMPLATES = {
  printing: [
    { id: 'item', q: 'What do you need?', type: 'choice', options: ['Calendars', 'Diaries and notebooks', 'Business cards', 'Flyers and brochures', 'Banners and signage', 'Branded items (pens, mugs, T-shirts, bags)', 'Corporate gift hampers', 'Other'], must: true },
    { id: 'qty', q: 'How many?', hint: 'e.g. 200', type: 'number', must: true },
    { id: 'size', q: 'Size or format', hint: 'e.g. A4 wall calendar, A5 diary, 3 x 1 m banner', type: 'text' },
    { id: 'colour', q: 'Colours', type: 'choice', options: ['Full colour', '1 to 2 colours', NOT_SURE] },
    { id: 'design', q: 'Is your logo or design ready?', type: 'choice', options: ['Yes, print-ready file', 'I have a logo, need a design', 'Need logo and design', NOT_SURE], must: true },
    { id: 'samples', q: 'Do you want a sample before the full order?', type: 'choice', options: ['Yes', 'No'] },
    { id: 'date', q: 'Delivery date', type: 'date', must: true },
    { id: 'budget', q: 'Budget range (optional)', hint: 'e.g. KSh 300 to 500 per piece', type: 'text' },
  ],
  logistics: [
    { id: 'goods', q: 'What are the goods?', hint: 'Be exact, e.g. 200 cartons of tiles, not "general goods"', type: 'text', must: true },
    { id: 'direction', q: 'Import, export or within Kenya?', type: 'choice', options: ['Import into Kenya', 'Export from Kenya', 'Within Kenya', 'To a nearby country'], must: true },
    { id: 'from', q: 'Pick-up place', hint: 'City and country, e.g. Guangzhou, China', type: 'text', must: true },
    { id: 'to', q: 'Delivery place', hint: 'e.g. our warehouse in Ruiru', type: 'text', must: true },
    { id: 'size', q: 'Packed size and total weight', hint: 'e.g. 2 pallets, 1.2 x 1 x 1.5 m, 800 kg', type: 'text', must: true },
    { id: 'ready', q: 'When will the goods be ready?', type: 'date' },
    { id: 'service', q: 'What help do you need?', type: 'choice', options: ['Transport only', 'Customs clearing only', 'Door to door (transport and clearing)', NOT_SURE] },
    { id: 'special', q: 'Any special cargo?', hint: 'Batteries, chemicals, fresh or very large items', type: 'text' },
  ],
  beauty: [
    { id: 'items', q: 'What are you looking for?', hint: 'e.g. matte lipstick in deep red, braiding hair, a perfume', type: 'text', must: true },
    { id: 'brand', q: 'Brand, shade or skin type (if you know)', hint: 'e.g. any brand, shade 45, oily skin', type: 'text' },
    { id: 'qty', q: 'How many?', hint: 'Just one, or stock for a salon or shop', type: 'text', must: true },
    { id: 'original', q: 'Must it be original (not a copy)?', type: 'choice', options: ['Yes, original only', 'Not important'] },
    { id: 'get', q: 'How do you want to get it?', type: 'choice', options: ['Delivery', 'I will pick up', 'Either'] },
    { id: 'date', q: 'Needed by', type: 'date' },
    { id: 'budget', q: 'Budget (optional)', type: 'text' },
  ],
  fashion: [
    { id: 'items', q: 'What are you looking for?', hint: 'e.g. 8 bridesmaid dresses, men\'s suit, school uniforms', type: 'text', must: true },
    { id: 'size', q: 'Sizes', hint: 'e.g. UK 10 to 16, or measurements', type: 'text', must: true },
    { id: 'colour', q: 'Colour and fabric', hint: 'e.g. emerald green chiffon', type: 'text' },
    { id: 'qty', q: 'How many?', type: 'number', must: true },
    { id: 'made', q: 'Ready-made or made to measure?', type: 'choice', options: ['Ready-made', 'Made to measure', 'Either'] },
    { id: 'get', q: 'How do you want to get it?', type: 'choice', options: ['Delivery', 'I will pick up', 'Either'] },
    { id: 'date', q: 'Needed by', type: 'date', must: true },
    { id: 'budget', q: 'Budget (optional)', type: 'text' },
  ],
  contractors: [
    { id: 'job', q: 'What is the job?', type: 'choice', options: ['New building', 'Extension', 'Renovation', 'Fence or gate', 'Roofing', 'Other'], must: true },
    { id: 'size', q: 'Size of the job', hint: 'e.g. 3-bedroom bungalow, 120 m of fence', type: 'text', must: true },
    { id: 'plans', q: 'Do you have approved plans?', type: 'choice', options: ['Yes', 'In progress', 'No, need help', NOT_SURE] },
    { id: 'materials', q: 'Who supplies materials?', type: 'choice', options: ['Contractor supplies all', 'I supply materials', NOT_SURE] },
    { id: 'site', q: 'Site location', hint: 'Town or area', type: 'text', must: true },
    { id: 'start', q: 'When should work start?', type: 'date' },
    { id: 'budget', q: 'Budget range (optional)', type: 'text' },
  ],
  electrical: [
    { id: 'job', q: 'What do you need?', type: 'choice', options: ['Home solar system', 'Solar water heater', 'Solar for a school, farm or business', 'House or office wiring', 'Fault repair', 'Other'], must: true },
    { id: 'use', q: 'What must it power, or what is the problem?', hint: 'e.g. lights, TV, fridge and a pump for 6 hours', type: 'text', must: true },
    { id: 'site', q: 'Site location', type: 'text', must: true },
    { id: 'kplc', q: 'Is the place connected to KPLC?', type: 'choice', options: ['Yes', 'No', NOT_SURE] },
    { id: 'date', q: 'When do you need it done?', type: 'date' },
    { id: 'budget', q: 'Budget range (optional)', type: 'text' },
  ],
};

export const PRIORITIES = { price: 'Lowest price', speed: 'Fastest delivery', quality: 'Quality or brand', terms: 'Payment terms' };
export const URGENCY = { today: 'Today', '24h': 'Within 24 hours', '48h': 'Within 2 days', '72h': 'Within 3 days' };
export const DEADLINE_HOURS = { today: 6, '24h': 24, '48h': 48, '72h': 72 };
export const templateFor = (category) => REQUEST_TEMPLATES[category] || GENERIC;

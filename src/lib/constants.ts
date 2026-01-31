import { Order, OrderItem } from '@/types/global';

export const GEMINI_MODEL_2POINT5_FlASH = "gemini-2.5-flash";
export const PROMPT_READ_MENU = `{
  "about_you": "You are the smart AI assistant whose primary task is to extract name, price, and description from the provided input.",
  "output_instructions": "
  * If the provided image/pdf does not have the information related to the menu items and price you will return the empty array. 
  * If the provided image/pdf does not contain the description of the items, in that case you will not generate the description from your end and will just return the empty string for the description.
  * Make sure to properly extract data related to the menu items and price.
  * Do not add the currency symbol in the price.
  "
}`;

// Server configuration
export const SERVER_URL = `http://localhost:${process.env.NEXT_PUBLIC_BACKEND_PORT}`;
// NOTE: NGROK URL/ Backend HERE
export const NGROK_URL = "https://e853935361d4.ngrok-free.app";
export const SAMPLE_ORDER_ITEMS: OrderItem[] = [
  {
    id: 'item-001',
    name: 'Margherita Pizza',
    quantity: 1,
    price: 18.99
  },
  {
    id: 'item-002',
    name: 'Caesar Salad',
    quantity: 2,
    price: 12.50
  },
  {
    id: 'item-003',
    name: 'Spaghetti Carbonara',
    quantity: 1,
    price: 22.95,
    specialInstructions: 'Extra parmesan cheese'
  },
  {
    id: 'item-004',
    name: 'Kung Pao Chicken',
    quantity: 1,
    price: 16.75,
    specialInstructions: 'Medium spice level'
  },
  {
    id: 'item-005',
    name: 'Vegetable Lo Mein',
    quantity: 1,
    price: 14.25
  }
];

// Sample data for development and testing
export const SAMPLE_CALLS = [
  {
    callId: 'call-001',
    phoneNumber: '(555) 123-4567',
    status: 'active' as const,
    orderId: 'order-001',
    restaurantId: 'rest-001',
    callStartTime: new Date('2024-01-15T18:30:00').getTime()
  },
  {
    callId: 'call-002',
    phoneNumber: '(555) 987-6543',
    status: 'completed' as const,
    orderId: 'order-002',
    restaurantId: 'rest-001',
    callStartTime: new Date('2024-01-15T17:45:00').getTime()
  },
  {
    callId: 'call-003',
    phoneNumber: '(555) 456-7890',
    status: 'completed' as const,
    restaurantId: 'rest-001',
    callStartTime: new Date('2024-01-15T16:20:00').getTime()
  },
  {
    callId: 'call-004',
    phoneNumber: '(555) 321-0987',
    status: 'active' as const,
    restaurantId: 'rest-001',
    callStartTime: new Date('2024-01-15T19:15:00').getTime()
  }
];

export const SAMPLE_ORDERS: Order[] = [
  {
    id: 'order-001',
    callId: 'call-001',
    phoneNumber: '(555) 123-4567',
    customerName: 'John Smith',
    items: [
      SAMPLE_ORDER_ITEMS[0], // Margherita Pizza
      SAMPLE_ORDER_ITEMS[1]  // Caesar Salad x2
    ],
    totalAmount: 43.99,
    specialInstructions: 'Please ring doorbell twice. Leave at door if no answer.',
    status: 'active',
    timestamp: new Date('2024-01-15T18:35:00')
  },
  {
    id: 'order-002',
    callId: 'call-002',
    phoneNumber: '(555) 987-6543',
    customerName: 'Sarah Johnson',
    items: [
      SAMPLE_ORDER_ITEMS[2] // Spaghetti Carbonara
    ],
    totalAmount: 22.95,
    status: 'completed',
    timestamp: new Date('2024-01-15T17:50:00')
  },
  {
    id: 'order-003',
    phoneNumber: '(555) 654-3210',
    customerName: 'Mike Chen',
    items: [
      SAMPLE_ORDER_ITEMS[3], // Kung Pao Chicken
      SAMPLE_ORDER_ITEMS[4]  // Vegetable Lo Mein
    ],
    totalAmount: 30.00,
    status: 'cancelled',
    cancellationReason: 'Customer requested cancellation due to dietary restrictions discovered after ordering',
    timestamp: new Date('2024-01-15T16:00:00')
  },
  {
    id: 'order-004',
    phoneNumber: '(555) 789-0123',
    customerName: 'Lisa Wang',
    items: [
      { ...SAMPLE_ORDER_ITEMS[0], quantity: 2 }, // 2x Margherita Pizza
      SAMPLE_ORDER_ITEMS[1] // Caesar Salad x2
    ],
    totalAmount: 62.48,
    specialInstructions: 'Contactless delivery preferred',
    status: 'completed',
    timestamp: new Date('2024-01-15T15:30:00')
  }
];

export const PHONE_NUMBER_PATTERNS = [
  '(555) ###-####',
  '555-###-####',
  '555.###.####'
];

export const LANGUAGE_OPTIONS = [
  { value: 'english', label: 'English' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'french', label: 'French' },
  { value: 'pidgin', label: 'Nigerian Pidgin' }
];

export const CALL_STATUS_CONFIG = {
  active: {
    label: 'Active',
    color: 'bg-green-100 text-green-800',
    icon: '🟢'
  },
  completed: {
    label: 'Completed',
    color: 'bg-gray-100 text-gray-800',
    icon: '✅'
  }
};

export const ORDER_STATUS_CONFIG = {
  active: {
    label: 'Active',
    color: 'bg-blue-100 text-blue-800',
    icon: '🔵'
  },
  completed: {
    label: 'Completed',
    color: 'bg-green-100 text-green-800',
    icon: '✅'
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-red-100 text-red-800',
    icon: '❌'
  }
};

export const SENTIMENT_CONFIG = {
  positive: {
    label: 'Positive',
    color: 'bg-green-100 text-green-800',
    icon: '😊'
  },
  neutral: {
    label: 'Neutral',
    color: 'bg-gray-100 text-gray-800',
    icon: '😐'
  },
  negative: {
    label: 'Negative',
    color: 'bg-red-100 text-red-800',
    icon: '😞'
  }
};

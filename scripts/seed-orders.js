/**
 * Seed script to create test orders in the database
 * Run with: node scripts/seed-orders.js
 */

const CONVEX_URL = "https://neat-clam-779.convex.cloud";

async function queryConvex(functionPath, args = {}) {
  const response = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: functionPath,
      args,
      format: "json",
    }),
  });
  
  const data = await response.json();
  return data;
}

async function mutateConvex(functionPath, args = {}) {
  const response = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: functionPath,
      args,
      format: "json",
    }),
  });
  
  const data = await response.json();
  return data;
}

async function main() {
  console.log("🔍 Querying restaurants...\n");
  
  // Query all restaurants
  const restaurantsResult = await queryConvex("restaurants:getAllRestaurants");
  
  if (!restaurantsResult.value || restaurantsResult.value.length === 0) {
    console.log("❌ No restaurants found in the database.");
    console.log("Please complete the onboarding process first at http://localhost:3000");
    return;
  }
  
  const restaurant = restaurantsResult.value[0];
  console.log("✅ Found restaurant:");
  console.log(`   Name: ${restaurant.name}`);
  console.log(`   ID: ${restaurant.restaurantId}`);
  console.log(`   Agent: ${restaurant.agentName}`);
  console.log(`   Language: ${restaurant.languagePreference}\n`);
  
  // Get branches for this restaurant
  const branchesResult = await queryConvex("branches:getBranchesByRestaurant", {
    restaurantId: restaurant.restaurantId
  });
  
  const branchId = branchesResult.value?.[0]?.branchId;
  if (branchId) {
    console.log(`   Branch: ${branchesResult.value[0].name} (${branchId})\n`);
  }
  
  // Define 6 orders with different statuses
  const orders = [
    {
      orderId: `ORD-${Date.now()}-001`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Chidi Okonkwo",
      customerPhone: "+2348012345678",
      items: [
        { name: "Jollof Rice", quantity: 2, price: 2500 },
        { name: "Grilled Chicken", quantity: 2, price: 3000 },
        { name: "Chapman", quantity: 2, price: 1500 }
      ],
      totalAmount: 14000,
      status: "active",
      paymentMethod: "cod",
      paymentStatus: "pending",
      deliveryStatus: "pending",
      specialInstructions: "Extra spicy please"
    },
    {
      orderId: `ORD-${Date.now()}-002`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Ngozi Adeyemi",
      customerPhone: "+2348023456789",
      items: [
        { name: "Fried Rice", quantity: 1, price: 2500 },
        { name: "Beef Suya", quantity: 3, price: 1500 },
        { name: "Zobo Drink", quantity: 2, price: 800 }
      ],
      totalAmount: 8600,
      status: "preparing",
      paymentMethod: "paystack",
      paymentStatus: "paid",
      deliveryStatus: "assigned",
      riderName: "Emeka Johnson",
      riderId: "RDR-001"
    },
    {
      orderId: `ORD-${Date.now()}-003`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Tunde Bakare",
      customerPhone: "+2348034567890",
      items: [
        { name: "Pounded Yam", quantity: 2, price: 3500 },
        { name: "Egusi Soup", quantity: 2, price: 2500 },
        { name: "Assorted Meat", quantity: 1, price: 4000 }
      ],
      totalAmount: 16000,
      status: "ready",
      paymentMethod: "flutterwave",
      paymentStatus: "paid",
      deliveryStatus: "dispatched",
      riderName: "Kunle Ajayi",
      riderId: "RDR-002",
      dispatchedAt: Date.now() - 15 * 60 * 1000 // 15 mins ago
    },
    {
      orderId: `ORD-${Date.now()}-004`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Amaka Eze",
      customerPhone: "+2348045678901",
      items: [
        { name: "Pepper Soup", quantity: 1, price: 3000 },
        { name: "Plantain", quantity: 2, price: 500 }
      ],
      totalAmount: 4000,
      status: "active",
      paymentMethod: "cod",
      paymentStatus: "pending",
      deliveryStatus: "in_transit",
      riderName: "Bola Ogundimu",
      riderId: "RDR-003",
      dispatchedAt: Date.now() - 25 * 60 * 1000 // 25 mins ago
    },
    {
      orderId: `ORD-${Date.now()}-005`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Femi Adebayo",
      customerPhone: "+2348056789012",
      items: [
        { name: "Amala", quantity: 3, price: 2000 },
        { name: "Ewedu Soup", quantity: 3, price: 1500 },
        { name: "Gbegiri", quantity: 3, price: 1500 },
        { name: "Soft Drinks", quantity: 3, price: 500 }
      ],
      totalAmount: 16500,
      status: "completed",
      paymentMethod: "paystack",
      paymentStatus: "paid",
      deliveryStatus: "delivered",
      riderName: "Segun Ola",
      riderId: "RDR-004",
      dispatchedAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
      deliveredAt: Date.now() - 30 * 60 * 1000 // 30 mins ago
    },
    {
      orderId: `ORD-${Date.now()}-006`,
      restaurantId: restaurant.restaurantId,
      branchId: branchId,
      customerName: "Yetunde Oladipo",
      customerPhone: "+2348067890123",
      items: [
        { name: "Ofada Rice", quantity: 2, price: 3000 },
        { name: "Ayamase Sauce", quantity: 2, price: 2000 }
      ],
      totalAmount: 10000,
      status: "cancelled",
      paymentMethod: "cod",
      paymentStatus: "pending",
      cancellationReason: "Customer changed their mind"
    }
  ];
  
  console.log("📝 Creating 6 test orders...\n");
  
  for (const order of orders) {
    try {
      const result = await mutateConvex("internal:upsertOrders", {
        data: {
          orderId: order.orderId,
          restaurantId: order.restaurantId,
          customerName: order.customerName,
          items: order.items,
          totalAmount: order.totalAmount,
          status: order.status,
          specialInstructions: order.specialInstructions,
          cancellationReason: order.cancellationReason,
        }
      });
      
      if (result.value?.success) {
        console.log(`✅ Created order: ${order.orderId}`);
        console.log(`   Customer: ${order.customerName}`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Total: ₦${order.totalAmount.toLocaleString()}`);
        
        // Now update with additional fields using updateOrder mutation
        if (order.paymentMethod || order.deliveryStatus || order.riderName) {
          // We need to get the order ID from the database first
          const ordersResult = await queryConvex("orders:getOrderByOrderId", {
            orderId: order.orderId
          });
          
          if (ordersResult.value?._id) {
            const updateResult = await mutateConvex("orders:updateOrder", {
              orderId: ordersResult.value._id,
              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,
              deliveryStatus: order.deliveryStatus,
              riderId: order.riderId,
              riderName: order.riderName,
              dispatchedAt: order.dispatchedAt,
              deliveredAt: order.deliveredAt,
              customerPhone: order.customerPhone,
              branchId: order.branchId,
            });
            
            if (updateResult.value) {
              console.log(`   Payment: ${order.paymentMethod} (${order.paymentStatus})`);
              if (order.deliveryStatus) {
                console.log(`   Delivery: ${order.deliveryStatus}${order.riderName ? ` - ${order.riderName}` : ''}`);
              }
            }
          }
        }
        console.log("");
      } else {
        console.log(`❌ Failed to create order: ${order.orderId}`);
        console.log(`   Error: ${result.value?.message || 'Unknown error'}\n`);
      }
    } catch (error) {
      console.log(`❌ Error creating order ${order.orderId}: ${error.message}\n`);
    }
  }
  
  console.log("🎉 Done! Check your dashboard at http://localhost:3000/client/dashboard");
}

main().catch(console.error);

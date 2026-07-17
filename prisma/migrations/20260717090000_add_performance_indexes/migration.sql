CREATE INDEX "Shipment_declarationDate_createdAt_idx"
ON "Shipment"("declarationDate", "createdAt");

CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");
CREATE INDEX "Shipment_channel_idx" ON "Shipment"("channel");

CREATE INDEX "ShipmentCost_shipmentId_createdAt_idx"
ON "ShipmentCost"("shipmentId", "createdAt");

CREATE INDEX "Quote_shipmentId_createdAt_idx"
ON "Quote"("shipmentId", "createdAt");

CREATE INDEX "Debt_type_createdAt_idx" ON "Debt"("type", "createdAt");
CREATE INDEX "Debt_dueDate_idx" ON "Debt"("dueDate");

CREATE INDEX "Task_relatedShipmentId_title_idx"
ON "Task"("relatedShipmentId", "title");

CREATE INDEX "Task_assignedToUserId_createdAt_idx"
ON "Task"("assignedToUserId", "createdAt");

CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

CREATE INDEX "Notification_userId_createdAt_idx"
ON "Notification"("userId", "createdAt");

CREATE INDEX "Notification_userId_isRead_idx"
ON "Notification"("userId", "isRead");

CREATE INDEX "Message_conversationId_createdAt_idx"
ON "Message"("conversationId", "createdAt");

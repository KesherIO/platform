import { OrderNeedingAttention } from '../../lab/order-attention.service';
import { OrderAttentionDto } from '../dto/order-attention.dto';

export function toOrderAttentionDto(
  order: OrderNeedingAttention
): OrderAttentionDto {
  return {
    orderId: order.orderId,
    requisitionNumber: order.requisitionNumber,
    status: order.status,
    priority: order.priority,
    patientName: order.patientName,
    patientSpecies: order.patientSpecies,
    clinicName: order.clinicName,
    ageMinutes: order.ageMinutes,
    severity: order.severity,
    reasons: order.attentionReasons.map((reason) => ({
      code: reason.code,
      message: reason.message,
      severity: reason.severity,
      elapsedMinutes: reason.elapsedMinutes,
      thresholdMinutes: reason.thresholdMinutes,
    })),
  };
}

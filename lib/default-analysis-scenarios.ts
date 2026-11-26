import type { ScenarioProvider } from '@/lib/xsmb-types'

export type DefaultAnalysisScenario = {
  id: string
  name: string
  provider: ScenarioProvider
  modelId: string
  prompt: string
  sortOrder: number
}

export const DEFAULT_ANALYSIS_SCENARIOS: DefaultAnalysisScenario[] = [
  {
    id: 'analysis-frequency-position',
    name: 'Tần suất & xác suất theo vị trí',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 5,
    prompt: 'Dùng đúng 10 kỳ GĐB gần nhất trong analysisContext.draws, theo thứ tự cũ đến mới. (1) Ở từng vị trí hàng nghìn/trăm/chục/đơn vị, liệt kê tần suất các chữ số 0-9; (2) tính tỷ lệ thực nghiệm count/10×100 và ghi top 3 mỗi vị trí; (3) tạo 3 bộ 4 số, tính tích tỷ lệ biên và gọi đây là điểm heuristic theo giả định độc lập, không phải xác suất trúng thật; (4) nêu chữ số ổn định nhất và ít xuất hiện nhất, kèm số lần. Ghi số liệu cụ thể, 1 chữ số thập phân; không dùng dữ liệu mẫu, placeholder hay bịa giá trị. Nếu thiếu dữ liệu, ghi rõ mẫu số thực tế.',
  },
  {
    id: 'analysis-number-cycles',
    name: 'Chu kỳ nóng, lạnh & bóng lặp',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 6,
    prompt: 'Dựa trên 10 kỳ GĐB trong analysisContext.draws: với từng vị trí và chữ số, nêu số kỳ từ lần xuất hiện gần nhất; tính khoảng cách trung bình giữa các lần xuất hiện nếu có ít nhất 2 lần. Phân loại nóng, lạnh dưới trung bình, và ngủ sâu trên 3 kỳ; báo số lần và mẫu số, không gọi tần suất ngắn hạn là xác suất thật. Tìm cặp chữ số/vị trí lặp ở các lần chuyển kỳ, ghi số lần trên tổng chuyển tiếp. Đưa 3 bộ 4 số, lý do, điểm heuristic và cảnh báo mẫu nhỏ; không bịa dữ liệu.',
  },
  {
    id: 'analysis-trend-parity',
    name: 'Xu hướng, chẵn lẻ & lớn nhỏ',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 7,
    prompt: 'Phân tích 10 đuôi GĐB theo trình tự thời gian trong analysisContext.draws. Với từng vị trí, ghi chuỗi chữ số và xu hướng tăng/giảm/đảo chiều; chấm +3 tăng rõ, +1 tăng nhẹ, 0 không rõ/đảo chiều, -1 giảm, nêu rõ cách quy đổi thành điểm heuristic %. Đếm chẵn/lẻ và nhỏ 0-4/lớn 5-9 trên tối đa 40 chữ số, ghi mẫu số thực tế. Chọn 1 bộ chính và 2 dự phòng; tính điểm kết hợp minh bạch, làm tròn 1 chữ số thập phân và cảnh báo đây không phải odds thật.',
  },
  {
    id: 'analysis-all-prizes',
    name: 'Tần suất toàn bộ giải & đuôi bóng',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 8,
    prompt: 'Dựa trên 10 đuôi giải đặc biệt gần nhất được cung cấp, phân tích chữ số theo từng vị trí và các cặp đuôi lặp. Nêu mẫu số thực tế, chọn một bộ 4 chữ số theo tần suất quan sát được và không suy diễn từ dữ liệu giải phụ không được cung cấp hoặc khẳng định xác suất chắc chắn.',
  },
  {
    id: 'analysis-weighted-methods',
    name: 'Trọng số 5 phương pháp',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 9,
    prompt: 'Dựa trên 10 đuôi giải đặc biệt gần nhất được cung cấp, so sánh tần suất các chữ số theo từng vị trí và xu hướng lặp. Nêu rõ số liệu mẫu ngắn, chọn một bộ 4 chữ số theo phương pháp tổng hợp và không coi tần suất là xác suất trúng thật. Không suy diễn hiệu suất lịch sử của phương pháp khác.',
  },
  {
    id: 'analysis-four-layer-optimization',
    name: 'Tối ưu 4 lớp & cảnh báo rủi ro',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 10,
    prompt: 'Tổng hợp tần suất đuôi giải đặc biệt và xu hướng theo từng vị trí từ 10 kỳ gần nhất được cung cấp. Nêu số liệu và giới hạn của mẫu ngắn, chọn một bộ 4 chữ số theo heuristic minh bạch. Không suy diễn hiệu suất lịch sử, không trình bày điểm heuristic như xác suất thật hay cam kết trúng.',
  },
]

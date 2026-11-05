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
    prompt: 'Dùng prizes của 10 kỳ trong analysisContext.draws. Tách 2 số cuối Giải 7, 3 số cuối Giải 6, 4 số cuối Giải 5/4/3/2/1 và GĐB; đếm tần suất chữ số/đuôi và mẫu số trên toàn bộ giải. So sánh các số có tần suất cao ở toàn bộ giải với đuôi GĐB riêng. Kiểm tra đuôi ở giải phụ có xuất hiện trong GĐB ở kỳ sau hay không, ghi số lần/tổng cơ hội. Đề xuất 3 bộ số, tỷ lệ thực nghiệm theo từng vị trí và mức tin cậy heuristic; nêu rõ phần dữ liệu thiếu, không suy diễn xác suất chắc chắn.',
  },
  {
    id: 'analysis-weighted-methods',
    name: 'Trọng số 5 phương pháp',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 9,
    prompt: 'Dựa trên analysisContext.methodPerformance và currentMethodPredictions, đối chiếu CT1/CT2/CT3/Gemini/DeepSeek trên 10 ngày có kết quả. Ghi số chữ số khớp/tổng chữ số dự đoán và %, không tự điền số liệu bị thiếu. Gán trọng số accuracy/maxAccuracy; nếu thiếu mẫu, loại phương pháp đó khỏi đồng thuận. Với dự đoán hiện tại đã lưu, tính phiếu có trọng số theo từng vị trí, đưa 3 bộ số xếp hạng và tổng điểm heuristic. Nếu chưa có dự đoán hiện tại của một phương pháp, ghi chưa có thay vì bịa.',
  },
  {
    id: 'analysis-four-layer-optimization',
    name: 'Tối ưu 4 lớp & cảnh báo rủi ro',
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    sortOrder: 10,
    prompt: 'Tổng hợp bốn lớp từ dữ liệu analysisContext: (1) tần suất toàn bộ giải; (2) tần suất đuôi GĐB; (3) đồng thuận có trọng số theo hiệu quả thật của 5 phương pháp; (4) xu hướng và chu kỳ. Với từng vị trí, chọn chữ số chính và số phụ, ghi % heuristic cùng số liệu/lý do. Xuất một bộ chính và hai bộ dự phòng, điểm kết hợp, độ bất đồng giữa phương pháp và cảnh báo rủi ro. Không dùng placeholder, không bịa hiệu suất, không trình bày điểm heuristic như xác suất thật hay cam kết trúng.',
  },
]

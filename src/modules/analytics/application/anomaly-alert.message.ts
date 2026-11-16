export interface AnomalyTopListing {
    listing_id: string;
    title: string;
    expected: number;
    actual: number;
    change_pct: number;
}

export interface AnomalyEvent {
    id: string;
    shop_id: string;
    date: string;
    metric: 'views' | 'revenue';
    direction: 'drop' | 'spike';
    rule: 'daily' | 'zero_run';
    z: number;
    expected: number;
    actual: number;
    change_pct: number;
    severity: string;
    calendar_sensitive: boolean;
    confidence: 'ok' | 'low_history';
    top_listings: AnomalyTopListing[];
}

const METRIC_LABEL = { revenue: 'Doanh thu', views: 'Lượt xem' };

const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
const shortDate = (date: string) => date.split('-').slice(1).reverse().join('/');
const absPct = (pct: number) => Math.abs(Math.round(pct));

export function buildAlertMessage(e: AnomalyEvent): { title: string; content: string } {
    if (e.rule === 'zero_run') {
        return {
            title: 'Shop không có đơn nhiều ngày liền',
            content: `Đến ngày ${shortDate(e.date)} shop không ghi nhận đơn trong nhiều ngày liền.`,
        };
    }

    const title = `${METRIC_LABEL[e.metric]} ${e.direction === 'drop' ? 'tụt bất thường' : 'tăng đột biến'}`;
    const unit = e.metric === 'revenue' ? 'đ' : ' lượt xem';
    const cmp = e.direction === 'drop' ? 'thấp hơn' : 'cao hơn';
    let content = `Ngày ${shortDate(e.date)}: ${fmt(e.actual)}${unit}, ${cmp} ${absPct(e.change_pct)}% mức thường (${fmt(e.expected)}${unit}).`;

    const top = e.top_listings?.[0];
    if (top) {
        const verb = top.change_pct < 0 ? 'giảm' : 'tăng';
        content += ` Nhiều nhất: ${top.title} ${verb} ${absPct(top.change_pct)}%.`;
    }
    return { title, content };
}

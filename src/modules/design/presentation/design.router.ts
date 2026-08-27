import { Router, Request, Response, NextFunction } from 'express';
import { DesignService, ForbiddenError } from '../application/design.service';
import { uploadDesign } from '../../../shared/upload/upload.middleware';
import { authenticate, requireRole, AuthenticatedRequest } from '../../../app/middleware/auth.middleware';

const router = Router();

// Bọc multer: lỗi file (sai type / quá lớn) → 400 rõ ràng thay vì rơi vào error handler chung (500).
const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    uploadDesign.single('file')(req, res, (err: any) => {
        if (err) return res.status(400).json({ error: err.message === 'File too large' ? 'File vượt quá 10MB.' : err.message });
        next();
    });
};

// Upload 1 artwork (multipart field 'file').
router.post('/', authenticate, requireRole(['seller', 'admin']), handleUpload, async (req: AuthenticatedRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Thiếu file thiết kế.' });
        const design = await DesignService.uploadDesign(req.user!.id, req.file, req.body?.name);
        res.status(201).json(design);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/mine', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await DesignService.listMyDesigns(req.user!.id));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', authenticate, requireRole(['seller', 'admin']), async (req: AuthenticatedRequest, res) => {
    try {
        res.json(await DesignService.deleteDesign(req.params.id, req.user!.id, req.user!.role));
    } catch (error: any) {
        if (error instanceof ForbiddenError) return res.status(403).json({ error: error.message });
        if (error.message === 'Design not found') return res.status(404).json({ error: error.message });
        res.status(400).json({ error: error.message });
    }
});

export const designsRouter = router;
export default designsRouter;

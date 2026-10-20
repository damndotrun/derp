import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { Note, NoteCreate, ProjectNotes, Survey, SurveyCreate } from '../shared.ts';
import { createNote, createSurvey, getSurvey, listProjectNotes } from './notes.ts';

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const projectParams = z.object({ projectId: z.uuid() });

  r.get('/api/notes/projects/:projectId', { schema: { params: projectParams, response: { 200: ProjectNotes } } }, async (req) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    return listProjectNotes(ctx.pool, project.id);
  });

  // Új jegyzet a kliens által kiosztott azonosítóval: új jegyzetnél 201, ugyanazzal újraküldve 200, mással 409.
  r.put(
    '/api/notes/projects/:projectId/notes/:noteId',
    {
      preHandler: ctx.requirePermission('notes.write'),
      schema: { params: projectParams.extend({ noteId: z.uuid() }), body: NoteCreate, response: { 200: Note, 201: Note } },
    },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      const { note, created } = await createNote(ctx, req, { id: req.params.noteId, projectId: project.id, ...req.body });
      return reply.code(created ? 201 : 200).send(note);
    },
  );

  // Új felmérés a kliens által kiosztott azonosítóval: új felmérésnél 201, ugyanazzal újraküldve 200, mással 409.
  r.put(
    '/api/notes/projects/:projectId/surveys/:surveyId',
    {
      preHandler: ctx.requirePermission('notes.write'),
      schema: { params: projectParams.extend({ surveyId: z.uuid() }), body: SurveyCreate, response: { 200: Survey, 201: Survey } },
    },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      const { survey, created } = await createSurvey(ctx, req, { id: req.params.surveyId, projectId: project.id, ...req.body });
      return reply.code(created ? 201 : 200).send(survey);
    },
  );

  r.get('/api/notes/surveys/:surveyId', { schema: { params: z.object({ surveyId: z.uuid() }), response: { 200: Survey } } }, async (req) => {
    const survey = await getSurvey(ctx.pool, req.params.surveyId);
    if (!survey) throw ctx.errors.notFound('A felmérés nem található');
    await ctx.requireProject(req, survey.projectId);
    return survey;
  });
}
